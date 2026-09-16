using Npgsql;
using NpgsqlTypes;
using Testhand.Admin.Config;
using Testhand.Admin.Security;

namespace Testhand.Admin.Data;

/// <summary>Session résolue à cette requête (T7).</summary>
public sealed record BackofficeSession(byte[] TokenHash, Guid UserId, string Email, string DisplayName, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, bool TotpVerified);

/// <summary>Sessions du back-office (T7) : jeton aléatoire, SHA-256 en base, cookie th_backoffice,
/// expiration ABSOLUE de 8 h jamais prolongée, rôle relu à chaque requête. Aucun lien avec
/// ygo_session : autre nom, autre table.</summary>
public sealed class SessionService(NpgsqlDataSource ds, BackofficeOptions options, TimeProvider clock, AuditService audit)
{
    public const string CookieName = "th_backoffice";

    public async Task CreateAsync(HttpContext ctx, Guid userId)
    {
        var token = SessionPolicy.NewToken();
        var now = clock.GetUtcNow();
        var expires = SessionPolicy.ExpiresAt(now);
        var ua = ctx.Request.Headers.UserAgent.ToString();
        await using var cmd = ds.CreateCommand(
            "insert into backoffice_sessions (token_hash, user_id, created_at, expires_at, user_agent, ip) values ($1, $2, $3, $4, $5, $6)");
        cmd.Parameters.Add(new NpgsqlParameter { Value = SessionPolicy.TokenHash(token), NpgsqlDbType = NpgsqlDbType.Bytea });
        cmd.Parameters.Add(new NpgsqlParameter { Value = userId, NpgsqlDbType = NpgsqlDbType.Uuid });
        cmd.Parameters.Add(new NpgsqlParameter { Value = now, NpgsqlDbType = NpgsqlDbType.TimestampTz });
        cmd.Parameters.Add(new NpgsqlParameter { Value = expires, NpgsqlDbType = NpgsqlDbType.TimestampTz });
        cmd.Parameters.Add(new NpgsqlParameter { Value = ua.Length > 300 ? ua[..300] : ua, NpgsqlDbType = NpgsqlDbType.Text });
        cmd.Parameters.Add(new NpgsqlParameter { Value = (object?)ctx.Connection.RemoteIpAddress?.ToString() ?? DBNull.Value, NpgsqlDbType = NpgsqlDbType.Text });
        await cmd.ExecuteNonQueryAsync();
        ctx.Response.Cookies.Append(CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = options.SecureCookies,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            Expires = expires,
            IsEssential = true,
        });
    }

    /// <summary>Cookie → session valide, ou null. Une session expirée ou dont le compte n'est plus
    /// admin est supprimée et journalisée ; le cookie est effacé.</summary>
    public async Task<BackofficeSession?> ResolveAsync(HttpContext ctx)
    {
        if (!ctx.Request.Cookies.TryGetValue(CookieName, out var token) || string.IsNullOrEmpty(token)) return null;
        var hash = SessionPolicy.TokenHash(token);
        await using var cmd = ds.CreateCommand(
            @"select s.user_id, u.email, u.display_name, s.created_at, s.expires_at, s.totp_verified_at is not null, u.role
              from backoffice_sessions s join users u on u.id = s.user_id where s.token_hash = $1");
        cmd.Parameters.Add(new NpgsqlParameter { Value = hash, NpgsqlDbType = NpgsqlDbType.Bytea });
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) { Clear(ctx); return null; }
        var s = new BackofficeSession(hash, r.GetGuid(0), r.GetString(1), r.GetString(2), r.GetFieldValue<DateTimeOffset>(3), r.GetFieldValue<DateTimeOffset>(4), r.GetBoolean(5));
        var role = r.GetString(6);
        await r.DisposeAsync();
        var now = clock.GetUtcNow();
        if (SessionPolicy.IsExpired(s.ExpiresAt, now))
        {
            await DeleteAsync(hash);
            await audit.RecordAsync("session.expired", s.UserId, s.Email, null, new { expiresAt = s.ExpiresAt });
            Clear(ctx);
            return null;
        }
        if (role != "admin")
        {
            await DeleteAsync(hash);
            await audit.RecordAsync("session.revoked", s.UserId, s.Email, null, new { reason = "role-removed" });
            Clear(ctx);
            return null;
        }
        return s;
    }

    public async Task MarkTotpVerifiedAsync(byte[] tokenHash)
    {
        await using var cmd = ds.CreateCommand("update backoffice_sessions set totp_verified_at = $2 where token_hash = $1");
        cmd.Parameters.Add(new NpgsqlParameter { Value = tokenHash, NpgsqlDbType = NpgsqlDbType.Bytea });
        cmd.Parameters.Add(new NpgsqlParameter { Value = clock.GetUtcNow(), NpgsqlDbType = NpgsqlDbType.TimestampTz });
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task DestroyAsync(HttpContext ctx, BackofficeSession session)
    {
        await DeleteAsync(session.TokenHash);
        Clear(ctx);
    }

    private async Task DeleteAsync(byte[] hash)
    {
        await using var cmd = ds.CreateCommand("delete from backoffice_sessions where token_hash = $1");
        cmd.Parameters.Add(new NpgsqlParameter { Value = hash, NpgsqlDbType = NpgsqlDbType.Bytea });
        await cmd.ExecuteNonQueryAsync();
    }

    private static void Clear(HttpContext ctx) => ctx.Response.Cookies.Delete(CookieName, new CookieOptions { Path = "/" });
}
