using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace Testhand.Admin.Data;

/// <summary>Journal en ajout seul (décision 8, T8) : une ligne par événement, écrite AVANT de
/// rendre la page. L'adresse et l'agent utilisateur de la requête courante sont joints au
/// détail. Le rôle PostgreSQL n'a que INSERT + SELECT sur backoffice_audit.</summary>
public sealed class AuditService(NpgsqlDataSource ds, IHttpContextAccessor http)
{
    public async Task RecordAsync(string action, Guid? actorUserId, string? actorEmail, Guid? targetUserId, object? detail = null)
    {
        var ctx = http.HttpContext;
        var d = new Dictionary<string, object?>();
        if (detail is not null)
            foreach (var p in JsonSerializer.SerializeToElement(detail).EnumerateObject()) d[p.Name] = p.Value;
        if (ctx is not null)
        {
            d["ip"] = ctx.Connection.RemoteIpAddress?.ToString();
            var ua = ctx.Request.Headers.UserAgent.ToString();
            d["ua"] = ua.Length > 300 ? ua[..300] : ua;
        }
        await using var cmd = ds.CreateCommand(
            "insert into backoffice_audit (actor_user_id, actor_email, action, target_user_id, detail, source) values ($1, $2, $3, $4, $5, 'web')");
        cmd.Parameters.Add(new NpgsqlParameter { Value = (object?)actorUserId ?? DBNull.Value, NpgsqlDbType = NpgsqlDbType.Uuid });
        cmd.Parameters.Add(new NpgsqlParameter { Value = (object?)actorEmail ?? DBNull.Value, NpgsqlDbType = NpgsqlDbType.Text });
        cmd.Parameters.Add(new NpgsqlParameter { Value = action, NpgsqlDbType = NpgsqlDbType.Text });
        cmd.Parameters.Add(new NpgsqlParameter { Value = (object?)targetUserId ?? DBNull.Value, NpgsqlDbType = NpgsqlDbType.Uuid });
        cmd.Parameters.Add(new NpgsqlParameter { Value = JsonSerializer.Serialize(d), NpgsqlDbType = NpgsqlDbType.Jsonb });
        await cmd.ExecuteNonQueryAsync();
    }
}
