using Npgsql;
using NpgsqlTypes;

namespace Testhand.Admin.Data;

public sealed record LoginAccount(Guid Id, string Email, string DisplayName, string? PasswordHash, string Role);

/// <summary>Une ligne de la liste ou de la fiche. <c>DeckCount</c> est un NOMBRE : le rôle n'a
/// aucun accès à deck.name (décision 7). <c>LastSessionAt</c> = ouverture de la session ENCORE
/// ACTIVE la plus récente (les sessions expirées ou fermées sont supprimées : la base ne connaît
/// pas de « dernière connexion », docs/backoffice.md Q2).</summary>
public sealed record AccountRow(Guid Id, string Email, string DisplayName, DateTimeOffset CreatedAt, string Role, bool HasPassword, long DeckCount, DateTimeOffset? LastSessionAt, string? Providers);

public sealed record AccountSession(DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, string? UserAgent);

public sealed record AccountsPage(IReadOnlyList<AccountRow> Rows, long Total, int Page, int PageSize)
{
    public int PageCount => (int)Math.Max(1, (Total + PageSize - 1) / PageSize);
}

/// <summary>Comptes : lecture par colonne (users, sessions sans token_hash, user_identities sans
/// provider_user_id, decks par son seul owner_id). Recherche, tri et pagination côté serveur.</summary>
public sealed class AccountsRepository(NpgsqlDataSource ds, TimeProvider clock)
{
    public const int PageSize = 50;
    public static readonly IReadOnlyDictionary<string, string> SortColumns = new Dictionary<string, string>
    {
        ["email"] = "email",
        ["nom"] = "display_name",
        ["creation"] = "created_at",
        ["session"] = "last_session_at",
        ["decks"] = "deck_count",
        ["role"] = "role",
    };

    public async Task<LoginAccount?> FindForLoginAsync(string email)
    {
        await using var cmd = ds.CreateCommand("select id, email, display_name, password_hash, role from users where lower(email) = lower($1)");
        cmd.Parameters.Add(new NpgsqlParameter { Value = email, NpgsqlDbType = NpgsqlDbType.Text });
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) return null;
        return new LoginAccount(r.GetGuid(0), r.GetString(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3), r.GetString(4));
    }

    private const string RowSelect = @"
        select u.id, u.email, u.display_name, u.created_at, u.role, u.password_hash is not null as has_password,
               (select count(*) from decks d where d.owner_id = u.id) as deck_count,
               (select max(s.created_at) from sessions s where s.user_id = u.id and s.expires_at > $1) as last_session_at,
               (select string_agg(i.provider, ', ' order by i.provider) from user_identities i where i.user_id = u.id) as providers
        from users u";

    public async Task<AccountsPage> ListAsync(string query, string sort, bool descending, int page)
    {
        var col = SortColumns.TryGetValue(sort, out var c) ? c : "email";
        var dir = descending ? "desc" : "asc";
        page = Math.Max(1, page);
        var now = clock.GetUtcNow();
        var like = "%" + query.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
        var where = query.Length == 0 ? "" : " where u.email ilike $2 escape '\\' or u.display_name ilike $2 escape '\\'";
        var total = await ds.ScalarAsync<long>("select count(*) from users u" + where.Replace("$2", "$1"), query.Length == 0 ? [] : [like]);
        await using var cmd = ds.CreateCommand(
            $"select * from ({RowSelect}{where}) t order by {col} {dir} nulls last, email asc limit {PageSize} offset {(page - 1) * PageSize}");
        cmd.Parameters.Add(new NpgsqlParameter { Value = now, NpgsqlDbType = NpgsqlDbType.TimestampTz });
        if (query.Length > 0) cmd.Parameters.Add(new NpgsqlParameter { Value = like, NpgsqlDbType = NpgsqlDbType.Text });
        var rows = new List<AccountRow>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) rows.Add(Read(r));
        return new AccountsPage(rows, total, page, PageSize);
    }

    public async Task<AccountRow?> GetAsync(Guid id)
    {
        await using var cmd = ds.CreateCommand(RowSelect + " where u.id = $2");
        cmd.Parameters.Add(new NpgsqlParameter { Value = clock.GetUtcNow(), NpgsqlDbType = NpgsqlDbType.TimestampTz });
        cmd.Parameters.Add(new NpgsqlParameter { Value = id, NpgsqlDbType = NpgsqlDbType.Uuid });
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync() ? Read(r) : null;
    }

    public async Task<IReadOnlyList<AccountSession>> ActiveSessionsAsync(Guid id)
    {
        await using var cmd = ds.CreateCommand("select created_at, expires_at, user_agent from sessions where user_id = $1 and expires_at > $2 order by created_at desc");
        cmd.Parameters.Add(new NpgsqlParameter { Value = id, NpgsqlDbType = NpgsqlDbType.Uuid });
        cmd.Parameters.Add(new NpgsqlParameter { Value = clock.GetUtcNow(), NpgsqlDbType = NpgsqlDbType.TimestampTz });
        var list = new List<AccountSession>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) list.Add(new AccountSession(r.GetFieldValue<DateTimeOffset>(0), r.GetFieldValue<DateTimeOffset>(1), r.IsDBNull(2) ? null : r.GetString(2)));
        return list;
    }

    private static AccountRow Read(NpgsqlDataReader r) => new(
        r.GetGuid(0), r.GetString(1), r.GetString(2), r.GetFieldValue<DateTimeOffset>(3), r.GetString(4), r.GetBoolean(5), r.GetInt64(6),
        r.IsDBNull(7) ? null : r.GetFieldValue<DateTimeOffset>(7), r.IsDBNull(8) ? null : r.GetString(8));
}
