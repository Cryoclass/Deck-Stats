using System.Net;
using System.Text.RegularExpressions;
using Npgsql;
using Testhand.Admin.Data;
using Testhand.Admin.Security;
using Testhand.Admin.Web;

namespace Testhand.Admin.Tests.Integration;

/// <summary>Preuves demandées par docs/backoffice.md §8 : refus sans session, avec un cookie de
/// joueur, avec un compte user, sans TOTP, après 8 h, après retrait du rôle ; une ligne de journal
/// par consultation ; aucun contenu de deck dans une réponse ni accessible au rôle ; scrypt Node.</summary>
[Collection("integration")]
public sealed partial class SiteTests(IntegrationFixture f) : IDisposable
{
    // Une instance d'app par test : la limite de débit (10 connexions par 5 min et par adresse)
    // compte aussi les connexions réussies, et la suite en fait plus de dix.
    private readonly Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> _app = f.NewFactory();
    public void Dispose() => _app.Dispose();
    private Browser New() => new(f.NewClient(_app));

    private async Task<Browser> LoginAsync(string email, string password = IntegrationFixture.Password)
    {
        var b = New();
        var r = await b.PostFormAsync("/login", new() { ["Email"] = email, ["Password"] = password });
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        Assert.Equal("/totp", r.Headers.Location!.ToString());
        Assert.NotNull(b.SessionCookie);
        return b;
    }

    private async Task<Browser> LoginTotpAsync(string email)
    {
        var b = await LoginAsync(email);
        Assert.Equal(HttpStatusCode.OK, (await b.GetAsync("/totp")).StatusCode);
        f.Clock.Now = f.Clock.Now.AddSeconds(30);  // pas suivant : un code ne sert qu'une fois (anti-rejeu)
        var secret = await SecretOf(email);
        var code = Totp.Code(secret, Totp.Counter(f.Clock.Now));
        var r = await b.PostFormAsync("/totp", new() { ["Code"] = code });
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        Assert.Equal("/", r.Headers.Location!.ToString());
        return b;
    }

    /// <summary>Secret TOTP du compte, déchiffré comme le site le fait (même clé d'environnement).</summary>
    private async Task<byte[]> SecretOf(string email)
    {
        var enc = await f.Owner.ScalarAsync<byte[]>("select t.secret_enc from backoffice_totp t join users u on u.id = t.user_id where u.email = $1", email);
        using var box = new SecretBox(Environment.GetEnvironmentVariable("BACKOFFICE_TOTP_KEY"));
        return box.Open(enc!);
    }

    private static string Location(HttpResponseMessage r) => r.Headers.Location?.ToString() ?? "";

    [IntegrationFact]
    public async Task Sans_session_tout_redirige_vers_login_sauf_health()
    {
        var b = New();
        foreach (var p in new[] { "/", "/comptes", "/journal", $"/comptes/{f.AdminId}", "/totp", "/logout" })
        {
            var r = await b.GetAsync(p);
            Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
            Assert.Equal("/login", Location(r));
        }
        var h = await b.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, h.StatusCode);
        Assert.Equal("ok", await h.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK, (await b.GetAsync("/login")).StatusCode);
    }

    [IntegrationFact]
    public async Task Cookie_de_l_app_de_jeu_ou_jeton_forge_ignores()
    {
        var b = New();
        b.Cookies["ygo_session"] = "SECRET-GAME-TOKEN-1a2b";
        var r = await b.GetAsync("/");
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        Assert.Equal("/login", Location(r));
        b.Cookies["th_backoffice"] = SessionPolicy.NewToken();
        r = await b.GetAsync("/comptes");
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        Assert.Equal("/login", Location(r));
        Assert.Null(b.SessionCookie);  // cookie invalide effacé par la réponse
    }

    [Theory]
    [InlineData("joueur@example.test", IntegrationFixture.Password, "not-admin")]
    [InlineData("oauth-admin@example.test", IntegrationFixture.Password, "no-password")]
    [InlineData("admin@example.test", "mauvais", "bad-password")]
    [InlineData("personne@example.test", IntegrationFixture.Password, "unknown")]
    public async Task Connexion_refusee_meme_reponse_raison_au_journal(string email, string password, string reason)
    {
        if (!IntegrationFixture.Enabled) return;
        var before = await f.AuditCount();
        var b = New();
        var r = await b.PostFormAsync("/login", new() { ["Email"] = email, ["Password"] = password });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = WebUtility.HtmlDecode(await r.Content.ReadAsStringAsync());  // Razor encode les accents (&#xE9;)
        Assert.Contains("Identifiants refusés.", body);
        Assert.Null(b.SessionCookie);
        Assert.Equal(before + 1, await f.AuditCount());
        var last = await f.LastAudit();
        Assert.Equal("login.failure", last.Action);
        Assert.Equal(email, last.Actor);
        Assert.Contains($"\"reason\": \"{reason}\"", last.Detail);
    }

    [IntegrationFact]
    public async Task Hachage_node_accepte_puis_second_facteur_exige()
    {
        var b = await LoginAsync("admin@example.test");
        var last = await f.LastAudit();
        Assert.Equal("login.success", last.Action);
        Assert.Equal("admin@example.test", last.Actor);
        foreach (var p in new[] { "/", "/comptes", "/journal", "/login" })
        {
            var r = await b.GetAsync(p);
            Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
            Assert.Equal("/totp", Location(r));
        }
    }

    [IntegrationFact]
    public async Task Enrolement_totp_confirme_au_premier_code_juste_puis_acces()
    {
        var b = await LoginAsync("admin@example.test");
        var page = await b.GetAsync("/totp");
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        var html = await page.Content.ReadAsStringAsync();
        var secret = await SecretOf("admin@example.test");
        var alreadyConfirmed = await f.Owner.ScalarAsync<bool>("select confirmed_at is not null from backoffice_totp where user_id = $1", f.AdminId);
        if (!alreadyConfirmed)
        {
            Assert.Contains("<svg", html);
            Assert.Contains(Base32.Encode(secret)[..4], html);
        }
        f.Clock.Now = f.Clock.Now.AddSeconds(30);
        var wrong = Totp.Code(secret, Totp.Counter(f.Clock.Now) - 5);  // hors fenêtre ± 1
        var r = await b.PostFormAsync("/totp", new() { ["Code"] = wrong });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("Code refusé.", WebUtility.HtmlDecode(await r.Content.ReadAsStringAsync()));
        Assert.Equal("totp.failure", (await f.LastAudit()).Action);
        Assert.Equal(HttpStatusCode.Redirect, (await b.GetAsync("/")).StatusCode);
        r = await b.PostFormAsync("/totp", new() { ["Code"] = Totp.Code(secret, Totp.Counter(f.Clock.Now)) });
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        Assert.Equal("/", Location(r));
        Assert.Equal("totp.success", (await f.LastAudit()).Action);
        Assert.True(await f.Owner.ScalarAsync<bool>("select confirmed_at is not null from backoffice_totp where user_id = $1", f.AdminId));
        Assert.True(await f.Owner.ScalarAsync<bool>("select exists (select 1 from backoffice_audit where action = 'totp.enrol' and actor_user_id = $1)", f.AdminId));
        var home = await b.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, home.StatusCode);
        Assert.Contains("Tableau de bord", await home.Content.ReadAsStringAsync());
        Assert.Equal("/", Location(await b.GetAsync("/totp")));
        f.Clock.Now = f.Clock.Now.AddSeconds(30);  // pas suivant : le code précédent ne resservira pas (unitaire), la suite avance l'horloge
    }

    [IntegrationFact]
    public async Task Chaque_consultation_ecrit_une_ligne_de_journal()
    {
        var b = await LoginTotpAsync("admin@example.test");
        var cases = new (string Path, string Action, Guid? Target, string DetailPart)[]
        {
            ("/", "view.dashboard", null, "\"ua\""),
            ("/comptes?q=adm&tri=decks&sens=desc&p=1", "view.accounts", null, "\"q\": \"adm\""),
            ($"/comptes/{f.UserId}", "view.account", f.UserId, "\"ip\""),
            ("/journal?action=login.success&acteur=admin", "view.audit", null, "\"actor\": \"admin\""),
        };
        foreach (var c in cases)
        {
            var before = await f.AuditCount();
            var r = await b.GetAsync(c.Path);
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            Assert.Equal(before + 1, await f.AuditCount());
            var last = await f.LastAudit();
            Assert.Equal(c.Action, last.Action);
            Assert.Equal("admin@example.test", last.Actor);
            Assert.Equal(c.Target, last.Target);
            Assert.Contains(c.DetailPart, last.Detail);
            Assert.Equal("web", last.Source);
        }
    }

    [IntegrationFact]
    public async Task Aucun_contenu_de_deck_ni_dans_les_pages_ni_pour_le_role()
    {
        var b = await LoginTotpAsync("admin@example.test");
        var markers = new[] { IntegrationFixture.DeckName, IntegrationFixture.DeckNotes, IntegrationFixture.DeckParam, "SECRET-GAME-TOKEN", "SECRET-DISCORD-ID", "90000001" };
        foreach (var p in new[] { "/", "/comptes", "/comptes?q=SECRET", $"/comptes/{f.AdminId}", $"/comptes/{f.OauthAdminId}", "/journal", "/journal?acteur=admin" })
        {
            var r = await b.GetAsync(p);
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            var html = await r.Content.ReadAsStringAsync();
            foreach (var m in markers) Assert.DoesNotContain(m, html);
        }
        var detail = await (await b.GetAsync($"/comptes/{f.AdminId}")).Content.ReadAsStringAsync();
        Assert.Matches("Decks</div><div class=\"kpi-value num\">1<", detail);          // le NOMBRE, jamais le nom
        Assert.Contains("SECRET-UA-OK", detail);                                          // l'agent utilisateur d'une session, lui, est affiché
        Assert.Contains("mot de passe", detail);
        var oauth = await (await b.GetAsync($"/comptes/{f.OauthAdminId}")).Content.ReadAsStringAsync();
        Assert.Contains("discord", oauth);

        // Garantie tenue par PostgreSQL, quel que soit le code du site : le rôle du site ne peut pas.
        foreach (var sql in new[] { "select name from decks", "select notes from decks", "select params from decks", "select summary from decks", "select * from deck_cards", "select * from deck_conditions", "select * from card_flags", "select * from cards", "select token_hash from sessions", "select provider_user_id from user_identities", "update users set role = 'admin' where role = 'user'", "insert into users (email, display_name) values ('x@example.test', 'x')", "delete from backoffice_audit", "update backoffice_audit set action = 'x'", "truncate backoffice_audit", "delete from backoffice_totp" })
        {
            var ex = await Assert.ThrowsAsync<PostgresException>(() => f.Site.ExecAsync(sql));
            Assert.Equal("42501", ex.SqlState);  // insufficient_privilege
        }
        Assert.Equal(1L, await f.Site.ScalarAsync<long>("select count(*) from decks where owner_id = $1", f.AdminId));
        // Ajout seul même pour le propriétaire : le déclencheur refuse.
        var owner = await Assert.ThrowsAsync<PostgresException>(() => f.Owner.ExecAsync("delete from backoffice_audit"));
        Assert.Contains("ajout seul", owner.MessageText);
    }

    [IntegrationFact]
    public async Task Session_coupee_a_8_heures_exactes_sans_glissement()
    {
        var t0 = f.Clock.Now;
        var b = await LoginTotpAsync("admin@example.test");
        var hash = SessionPolicy.TokenHash(b.SessionCookie!);
        var expires = await f.Owner.ScalarAsync<DateTimeOffset>("select expires_at from backoffice_sessions where token_hash = $1", hash);
        Assert.Equal(t0.AddHours(8), expires);
        f.Clock.Now = t0.AddHours(7).AddMinutes(59);
        Assert.Equal(HttpStatusCode.OK, (await b.GetAsync("/")).StatusCode);
        Assert.Equal(expires, await f.Owner.ScalarAsync<DateTimeOffset>("select expires_at from backoffice_sessions where token_hash = $1", hash));  // jamais prolongée
        f.Clock.Now = t0.AddHours(8).AddMinutes(1);
        var r = await b.GetAsync("/");
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        Assert.Equal("/login", Location(r));
        Assert.Null(b.SessionCookie);
        Assert.Equal(0L, await f.Owner.ScalarAsync<long>("select count(*) from backoffice_sessions where token_hash = $1", hash));
        Assert.Equal("session.expired", (await f.LastAudit()).Action);
        f.Clock.Now = t0.AddMinutes(1);
    }

    [IntegrationFact]
    public async Task Retrait_du_role_coupe_la_session_a_la_requete_suivante()
    {
        var b = await LoginTotpAsync("admin2@example.test");
        Assert.Equal(HttpStatusCode.OK, (await b.GetAsync("/comptes")).StatusCode);
        await f.Owner.ExecAsync("update users set role = 'user' where id = $1", f.Admin2Id);
        try
        {
            var r = await b.GetAsync("/comptes");
            Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
            Assert.Equal("/login", Location(r));
            Assert.Null(b.SessionCookie);
            Assert.Equal(0L, await f.Owner.ScalarAsync<long>("select count(*) from backoffice_sessions where user_id = $1", f.Admin2Id));
            var last = await f.LastAudit();
            Assert.Equal("session.revoked", last.Action);
            Assert.Equal("admin2@example.test", last.Actor);
            var again = New();
            var login = await again.PostFormAsync("/login", new() { ["Email"] = "admin2@example.test", ["Password"] = IntegrationFixture.Password });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);  // plus admin : refusé comme un joueur
            Assert.Contains("\"reason\": \"not-admin\"", (await f.LastAudit()).Detail);
        }
        finally { await f.Owner.ExecAsync("update users set role = 'admin' where id = $1", f.Admin2Id); }
    }

    [IntegrationFact]
    public async Task Deconnexion_supprime_la_session_et_le_journalise()
    {
        var b = await LoginTotpAsync("admin@example.test");
        var hash = SessionPolicy.TokenHash(b.SessionCookie!);
        var r = await b.PostFormAsync("/logout", new());
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        Assert.Equal("/login", Location(r));
        Assert.Null(b.SessionCookie);
        Assert.Equal("logout", (await f.LastAudit()).Action);
        Assert.Equal(0L, await f.Owner.ScalarAsync<long>("select count(*) from backoffice_sessions where token_hash = $1", hash));
        Assert.Equal("/login", Location(await b.GetAsync("/")));
    }

    [IntegrationFact]
    public async Task En_tetes_de_securite_sur_toute_reponse()
    {
        var r = await New().GetAsync("/login");
        Assert.Equal(SecurityHeadersMiddleware.Csp, r.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal("nosniff", r.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("no-referrer", r.Headers.GetValues("Referrer-Policy").Single());
        Assert.Equal("noindex, nofollow", r.Headers.GetValues("X-Robots-Tag").Single());
        Assert.Equal("DENY", r.Headers.GetValues("X-Frame-Options").Single());
        Assert.Contains("no-store", r.Headers.CacheControl!.ToString());
        var html = await r.Content.ReadAsStringAsync();
        Assert.DoesNotContain("<script>", html);           // aucun script inline
        Assert.DoesNotContain("https://", html.Replace("http://www.w3.org", ""));  // aucune ressource externe
        Assert.Contains("class=\"env env-dev\"", html);
    }

    [IntegrationFact]
    public async Task Post_sans_jeton_antiforgery_refuse()
    {
        var b = New();
        var r = await b.GetAsync("/login");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var http = f.NewClient(_app);
        var post = await http.PostAsync("/login", new FormUrlEncodedContent(new Dictionary<string, string> { ["Email"] = "admin@example.test", ["Password"] = IntegrationFixture.Password }));
        Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
        Assert.DoesNotContain(post.Headers.TryGetValues("Set-Cookie", out var sc) ? sc : [], c => c.StartsWith("th_backoffice="));
    }

    [IntegrationFact]
    public async Task Fiche_inconnue_journalisee_puis_404_et_pagination_bornee()
    {
        var b = await LoginTotpAsync("admin@example.test");
        var unknown = Guid.NewGuid();
        var before = await f.AuditCount();
        var r = await b.GetAsync($"/comptes/{unknown}");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.Equal(before + 1, await f.AuditCount());
        Assert.Equal(unknown, (await f.LastAudit()).Target);
        Assert.Equal(HttpStatusCode.OK, (await b.GetAsync("/comptes?p=2147483647")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await b.GetAsync("/journal?p=2147483647&cible=" + new string('x', 500))).StatusCode);
        Assert.Equal(HttpStatusCode.InternalServerError, (await New().GetAsync("/erreur")).StatusCode);
    }

    [IntegrationFact]
    public async Task Limite_de_debit_sur_la_connexion()
    {
        using var factory = f.NewFactory();
        var b = new Browser(f.NewClient(factory));
        for (var i = 0; i < 10; i++)
            Assert.Equal(HttpStatusCode.OK, (await b.PostFormAsync("/login", new() { ["Email"] = "admin@example.test", ["Password"] = "faux" })).StatusCode);
        var r = await b.PostFormAsync("/login", new() { ["Email"] = "admin@example.test", ["Password"] = "faux" });
        Assert.Equal(HttpStatusCode.TooManyRequests, r.StatusCode);
        Assert.Equal("login.throttled", (await f.LastAudit()).Action);
        Assert.Equal(HttpStatusCode.OK, (await b.GetAsync("/login")).StatusCode);  // le formulaire reste accessible
    }

    [IntegrationFact]
    public async Task Ligne_de_commande_du_role_simulation_puis_application_journalisee()
    {
        var sql = await File.ReadAllTextAsync(Path.Combine(IntegrationFixture.RepoRoot, "deploy", "backoffice-role.sql"));
        async Task<List<string>> Run(string action, string email, bool apply)
        {
            await using var conn = await f.Owner.OpenConnectionAsync();
            await using (var set = new NpgsqlCommand($"select set_config('testhand.role_action', '{action}', false), set_config('testhand.role_email', '{email}', false), set_config('testhand.role_apply', '{(apply ? "1" : "")}', false), set_config('testhand.role_actor', 'test-integration', false)", conn))
                await set.ExecuteNonQueryAsync();
            var lines = new List<string>();
            await using var cmd = new NpgsqlCommand(sql, conn);
            await using var r = await cmd.ExecuteReaderAsync();
            do { while (await r.ReadAsync()) if (r.FieldCount == 1 && !r.IsDBNull(0) && r.GetFieldType(0) == typeof(string)) lines.Add(r.GetString(0)); } while (await r.NextResultAsync());
            return lines;
        }
        var before = await f.AuditCount();
        var sim = await Run("grant", "JOUEUR@example.test", false);
        Assert.Contains(sim, l => l.StartsWith("statut | SIMULATION TERMINÉE"));
        Assert.Equal("user", await f.Owner.ScalarAsync<string>("select role from users where id = $1", f.UserId));
        Assert.Equal(before, await f.AuditCount());
        var applied = await Run("grant", "joueur@example.test", true);
        Assert.Contains(applied, l => l.StartsWith("statut | APPLIQUÉ"));
        Assert.Equal("admin", await f.Owner.ScalarAsync<string>("select role from users where id = $1", f.UserId));
        var last = await f.LastAudit();
        Assert.Equal(("role.grant", "test-integration", f.UserId, "cli"), (last.Action, last.Actor, last.Target, last.Source));
        var revoked = await Run("revoke", "joueur@example.test", true);
        Assert.Contains(revoked, l => l.StartsWith("statut | APPLIQUÉ"));
        Assert.Equal("user", await f.Owner.ScalarAsync<string>("select role from users where id = $1", f.UserId));
        Assert.Equal("role.revoke", (await f.LastAudit()).Action);
        var ex = await Assert.ThrowsAsync<PostgresException>(() => Run("grant", "personne@example.test", true));
        Assert.Contains("aucun compte pour", ex.MessageText);
    }
}
