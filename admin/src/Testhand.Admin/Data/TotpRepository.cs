using Npgsql;
using NpgsqlTypes;

namespace Testhand.Admin.Data;

public sealed record TotpRow(byte[] SecretEnc, DateTimeOffset? ConfirmedAt, long LastCounter);

/// <summary>Second facteur (T6) : secret chiffré, enrôlement confirmé au premier code juste,
/// dernier pas accepté (anti-rejeu). Le rôle a SELECT, INSERT, UPDATE ; jamais DELETE.</summary>
public sealed class TotpRepository(NpgsqlDataSource ds, TimeProvider clock)
{
    public async Task<TotpRow?> GetAsync(Guid userId)
    {
        await using var cmd = ds.CreateCommand("select secret_enc, confirmed_at, last_counter from backoffice_totp where user_id = $1");
        cmd.Parameters.Add(new NpgsqlParameter { Value = userId, NpgsqlDbType = NpgsqlDbType.Uuid });
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) return null;
        return new TotpRow(r.GetFieldValue<byte[]>(0), r.IsDBNull(1) ? null : r.GetFieldValue<DateTimeOffset>(1), r.GetInt64(2));
    }

    /// <summary>Enrôlement en cours : secret posé (ou remplacé s'il n'a jamais été confirmé).</summary>
    public async Task BeginEnrolmentAsync(Guid userId, byte[] secretEnc)
    {
        await using var cmd = ds.CreateCommand(
            @"insert into backoffice_totp (user_id, secret_enc, confirmed_at, last_counter, created_at) values ($1, $2, null, 0, $3)
              on conflict (user_id) do update set secret_enc = excluded.secret_enc, last_counter = 0, created_at = excluded.created_at
              where backoffice_totp.confirmed_at is null");
        cmd.Parameters.Add(new NpgsqlParameter { Value = userId, NpgsqlDbType = NpgsqlDbType.Uuid });
        cmd.Parameters.Add(new NpgsqlParameter { Value = secretEnc, NpgsqlDbType = NpgsqlDbType.Bytea });
        cmd.Parameters.Add(new NpgsqlParameter { Value = clock.GetUtcNow(), NpgsqlDbType = NpgsqlDbType.TimestampTz });
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>Accepte un pas : l'UPDATE est conditionné à <c>last_counter &lt; pas</c>, donc deux
    /// requêtes simultanées avec le même code ne peuvent pas passer toutes les deux (T6). Rend false
    /// si le pas a déjà été consommé entre la lecture et l'écriture.</summary>
    public async Task<bool> AcceptAsync(Guid userId, long acceptedCounter, bool confirm)
    {
        await using var cmd = ds.CreateCommand(confirm
            ? "update backoffice_totp set last_counter = $2, confirmed_at = coalesce(confirmed_at, $3) where user_id = $1 and last_counter < $2"
            : "update backoffice_totp set last_counter = $2 where user_id = $1 and last_counter < $2");
        cmd.Parameters.Add(new NpgsqlParameter { Value = userId, NpgsqlDbType = NpgsqlDbType.Uuid });
        cmd.Parameters.Add(new NpgsqlParameter { Value = acceptedCounter, NpgsqlDbType = NpgsqlDbType.Bigint });
        if (confirm) cmd.Parameters.Add(new NpgsqlParameter { Value = clock.GetUtcNow(), NpgsqlDbType = NpgsqlDbType.TimestampTz });
        return await cmd.ExecuteNonQueryAsync() == 1;
    }
}
