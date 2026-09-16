using Npgsql;
using NpgsqlTypes;

namespace Testhand.Admin.Data;

public sealed record AuditRow(long Id, DateTimeOffset At, Guid? ActorUserId, string? ActorEmail, string Action, Guid? TargetUserId, string Detail, string Source);

public sealed record AuditFilter(string Action, string Actor, Guid? Target, DateTimeOffset? From, DateTimeOffset? To, int Page);

public sealed record AuditPage(IReadOnlyList<AuditRow> Rows, long Total, int Page, int PageSize)
{
    public int PageCount => (int)Math.Max(1, (Total + PageSize - 1) / PageSize);
}

/// <summary>Consultation du journal (décision 8) : filtres par action, acteur, cible, période ;
/// pagination côté serveur. Lecture seule : le rôle n'a ni UPDATE ni DELETE, et le déclencheur
/// les refuse à tout le monde.</summary>
public sealed class AuditRepository(NpgsqlDataSource ds)
{
    public const int PageSize = 50;

    public async Task<IReadOnlyList<string>> ActionsAsync()
    {
        var list = new List<string>();
        await using var cmd = ds.CreateCommand("select distinct action from backoffice_audit order by action");
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) list.Add(r.GetString(0));
        return list;
    }

    public async Task<AuditPage> ListAsync(AuditFilter f)
    {
        var where = new List<string>();
        var args = new List<NpgsqlParameter>();
        void Add(string clause, object value, NpgsqlDbType type) { args.Add(new NpgsqlParameter { Value = value, NpgsqlDbType = type }); where.Add(clause.Replace("?", "$" + args.Count)); }
        if (f.Action.Length > 0) Add("action = ?", f.Action, NpgsqlDbType.Text);
        if (f.Actor.Length > 0) Add("actor_email ilike ? escape '\\'", "%" + f.Actor.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%", NpgsqlDbType.Text);
        if (f.Target is { } t) Add("target_user_id = ?", t, NpgsqlDbType.Uuid);
        if (f.From is { } from) Add("at >= ?", from, NpgsqlDbType.TimestampTz);
        if (f.To is { } to) Add("at < ?", to, NpgsqlDbType.TimestampTz);
        var sql = where.Count == 0 ? "" : " where " + string.Join(" and ", where);
        var page = Math.Max(1, f.Page);
        await using var count = ds.CreateCommand("select count(*) from backoffice_audit" + sql);
        foreach (var a in args) count.Parameters.Add(a.Clone());
        var total = (long)(await count.ExecuteScalarAsync() ?? 0L);
        await using var cmd = ds.CreateCommand(
            $"select id, at, actor_user_id, actor_email, action, target_user_id, detail::text, source from backoffice_audit{sql} order by id desc limit {PageSize} offset {(page - 1) * PageSize}");
        foreach (var a in args) cmd.Parameters.Add(a.Clone());
        var rows = new List<AuditRow>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            rows.Add(new AuditRow(r.GetInt64(0), r.GetFieldValue<DateTimeOffset>(1), r.IsDBNull(2) ? null : r.GetGuid(2), r.IsDBNull(3) ? null : r.GetString(3),
                r.GetString(4), r.IsDBNull(5) ? null : r.GetGuid(5), r.GetString(6), r.GetString(7)));
        return new AuditPage(rows, total, page, PageSize);
    }
}
