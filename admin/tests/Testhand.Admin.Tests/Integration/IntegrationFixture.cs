using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Testhand.Admin.Data;

namespace Testhand.Admin.Tests.Integration;

/// <summary>Horloge simulée : la session de 8 h absolues se teste sans attendre.</summary>
public sealed class FakeClock : TimeProvider
{
    public DateTimeOffset Now { get; set; } = new(2026, 9, 16, 12, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => Now;
}

/// <summary>Suite d'intégration (docs/backoffice.md T13) sur le conteneur jetable
/// testhand-backoffice-db (127.0.0.1:55442) : URL exacte exigée, base vide exigée, schéma et
/// migrations 001 à 005 appliqués, puis l'app est branchée AVEC LE RÔLE RESTREINT
/// (testhand_backoffice) ; le propriétaire ygo ne sert qu'aux fixtures et aux vérifications.
/// Réinitialise le schéma public à la fin.</summary>
public sealed class IntegrationFixture : IAsyncLifetime
{
    public const string OwnerUrl = "postgres://ygo:ygo-disposable@127.0.0.1:55442/ygo";
    public const string SiteUrl = "postgres://testhand_backoffice:bo-disposable@127.0.0.1:55442/ygo";
    public const string Password = "password";
    public const string DeckName = "SECRET-DECK-NAME-7f3a";
    public const string DeckNotes = "SECRET-NOTES-9c1d";
    public const string DeckParam = "SECRET-PARAM-2b8e";
    public static bool Enabled => Environment.GetEnvironmentVariable("BACKOFFICE_TEST_DATABASE_URL") == OwnerUrl;
    public static string RepoRoot { get; } = FindRoot();

    public FakeClock Clock { get; } = new();
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public NpgsqlDataSource Owner { get; private set; } = null!;
    public NpgsqlDataSource Site { get; private set; } = null!;
    public string NodeHash { get; private set; } = "";
    public Guid AdminId { get; private set; }
    public Guid Admin2Id { get; private set; }
    public Guid UserId { get; private set; }
    public Guid OauthAdminId { get; private set; }
    public Guid DeckId { get; private set; }

    public async Task InitializeAsync()
    {
        if (!Enabled) return;
        Owner = Db.CreateDataSource(OwnerUrl);
        var tables = await Owner.ScalarAsync<long>("select count(*) from pg_tables where schemaname = 'public'");
        if (tables != 0) throw new InvalidOperationException("La suite d'intégration exige une base jetable VIDE (schéma public sans table).");
        foreach (var f in new[] { "db/schema.sql", "db/migrations/001-deck-configuration.sql", "db/migrations/002-profiles-and-conditions.sql", "db/migrations/003-purge-legacy.sql", "db/migrations/004-side-plans.sql", "db/migrations/005-backoffice.sql" })
            await Owner.ExecAsync(await File.ReadAllTextAsync(Path.Combine(RepoRoot, f)));
        await Owner.ExecAsync("alter role testhand_backoffice with login password 'bo-disposable'");

        // Hachage produit par le code Node (fixture générée par make-scrypt-vectors.mjs).
        using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "fixtures", "scrypt-node-vectors.json")));
        NodeHash = doc.RootElement.GetProperty("entries").EnumerateArray().First(e => e.GetProperty("password").GetString() == Password && e.GetProperty("matches").GetBoolean()).GetProperty("hash").GetString()!;

        AdminId = await InsertUser("admin@example.test", "Admin Un", NodeHash, "admin");
        Admin2Id = await InsertUser("admin2@example.test", "Admin Deux", NodeHash, "admin");
        UserId = await InsertUser("joueur@example.test", "Joueur", NodeHash, "user");
        OauthAdminId = await InsertUser("oauth-admin@example.test", "Admin Discord", null, "admin");
        await Owner.ExecAsync("insert into user_identities (provider, provider_user_id, user_id) values ('discord', 'SECRET-DISCORD-ID-5e1c', $1)", OauthAdminId);
        DeckId = (await Owner.ScalarAsync<Guid>("insert into decks (owner_id, name, notes, params) values ($1, $2, $3, $4::jsonb) returning id", AdminId, DeckName, DeckNotes, $"{{\"marker\": \"{DeckParam}\"}}"))!;
        await Owner.ExecAsync("insert into deck_cards (deck_id, card_id, zone, copies) values ($1, 90000001, 'main', 3)", DeckId);
        await Owner.ExecAsync("insert into sessions (token_hash, user_id, expires_at, user_agent) values (sha256('SECRET-GAME-TOKEN-1a2b'::bytea), $1, $2, 'GameBrowser/1.0 (SECRET-UA-OK)')", AdminId, Clock.Now.AddDays(30));

        Environment.SetEnvironmentVariable("BACKOFFICE_DATABASE_URL", SiteUrl);
        Environment.SetEnvironmentVariable("BACKOFFICE_TOTP_KEY", Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray()));
        Environment.SetEnvironmentVariable("BACKOFFICE_ENV", "DEV");
        Environment.SetEnvironmentVariable("BACKOFFICE_HOST", "test.local");
        Environment.SetEnvironmentVariable("BACKOFFICE_TRUST_PROXY", null);
        Factory = NewFactory();
        Site = Db.CreateDataSource(SiteUrl);
    }

    /// <summary>Une instance d'app séparée (limite de débit indépendante), même horloge.</summary>
    public WebApplicationFactory<Program> NewFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<TimeProvider>(Clock)));

    public HttpClient NewClient(WebApplicationFactory<Program>? factory = null) =>
        (factory ?? Factory).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = false });

    public async Task<long> AuditCount() => await Owner.ScalarAsync<long>("select count(*) from backoffice_audit");

    public async Task<(string Action, string? Actor, Guid? Target, string Detail, string Source)> LastAudit()
    {
        await using var cmd = Owner.CreateCommand("select action, actor_email, target_user_id, detail::text, source from backoffice_audit order by id desc limit 1");
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) throw new InvalidOperationException("journal vide");
        return (r.GetString(0), r.IsDBNull(1) ? null : r.GetString(1), r.IsDBNull(2) ? null : r.GetGuid(2), r.GetString(3), r.GetString(4));
    }

    private async Task<Guid> InsertUser(string email, string name, string? hash, string role) =>
        (await Owner.ScalarAsync<Guid>("insert into users (email, display_name, password_hash, role) values ($1, $2, $3, $4) returning id", email, name, hash, role))!;

    public async Task DisposeAsync()
    {
        if (!Enabled) return;
        Factory.Dispose();
        await Site.DisposeAsync();
        await Owner.ExecAsync("drop schema public cascade; create schema public;");
        await Owner.DisposeAsync();
    }

    private static string FindRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "db", "schema.sql"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("racine du dépôt (db/schema.sql) introuvable");
    }
}

[CollectionDefinition("integration")]
public sealed class IntegrationCollection : ICollectionFixture<IntegrationFixture>;

/// <summary>Fait d'intégration : ignoré sans BACKOFFICE_TEST_DATABASE_URL (URL jetable exacte).</summary>
public sealed class IntegrationFactAttribute : FactAttribute
{
    public IntegrationFactAttribute()
    {
        if (!IntegrationFixture.Enabled) Skip = "BACKOFFICE_TEST_DATABASE_URL absente ou différente de l'URL jetable exacte (127.0.0.1:55442) : tests d'intégration ignorés.";
    }
}
