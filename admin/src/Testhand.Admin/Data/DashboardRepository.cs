using Npgsql;
using NpgsqlTypes;

namespace Testhand.Admin.Data;

public sealed record CatalogInfo(string Version, DateTimeOffset MigratedAt, int LocalCards);

/// <summary>Tableau de bord (décision 9). « Sessions actives » = sessions de l'app non expirées à
/// cet instant, rien de plus : la base ne connaît ni activité ni présence.</summary>
public sealed record Dashboard(long Accounts, long Created7Days, long Created30Days, long ActiveSessions, long Decks, long Admins, CatalogInfo? Catalog);

public sealed class DashboardRepository(NpgsqlDataSource ds, TimeProvider clock)
{
    public async Task<Dashboard> LoadAsync()
    {
        var now = clock.GetUtcNow();
        await using var cmd = ds.CreateCommand(@"
            select (select count(*) from users),
                   (select count(*) from users where created_at > $1 - interval '7 days'),
                   (select count(*) from users where created_at > $1 - interval '30 days'),
                   (select count(*) from sessions where expires_at > $1),
                   (select count(*) from decks),
                   (select count(*) from users where role = 'admin')");
        cmd.Parameters.Add(new NpgsqlParameter { Value = now, NpgsqlDbType = NpgsqlDbType.TimestampTz });
        await using var r = await cmd.ExecuteReaderAsync();
        await r.ReadAsync();
        var d = new Dashboard(r.GetInt64(0), r.GetInt64(1), r.GetInt64(2), r.GetInt64(3), r.GetInt64(4), r.GetInt64(5), null);
        await r.DisposeAsync();
        await using var cat = ds.CreateCommand("select version, migrated_at, local_cards_count from catalog_version");
        await using var rc = await cat.ExecuteReaderAsync();
        if (await rc.ReadAsync()) d = d with { Catalog = new CatalogInfo(rc.GetString(0), rc.GetFieldValue<DateTimeOffset>(1), rc.GetInt32(2)) };
        return d;
    }
}
