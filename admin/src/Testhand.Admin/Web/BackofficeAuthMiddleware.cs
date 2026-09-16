using Testhand.Admin.Data;

namespace Testhand.Admin.Web;

/// <summary>Garde de session (docs/backoffice.md §5, T7). Privée par défaut : seuls /login,
/// /health, /css et /js sont publics. Une session sans second facteur validé n'atteint que /totp
/// et /logout. Le rôle est relu à chaque requête par SessionService.ResolveAsync.</summary>
public sealed class BackofficeAuthMiddleware(RequestDelegate next)
{
    public async Task Invoke(HttpContext ctx, SessionService sessions, CurrentUser current)
    {
        var path = (ctx.Request.Path.Value ?? "/").TrimEnd('/');
        if (path.Length == 0) path = "/";
        var lower = path.ToLowerInvariant();
        // /erreur : page rendue par UseExceptionHandler, avant la garde dans le pipeline mais ré-exécutée à
        // travers elle ; elle ne lit rien et le gabarit masque la navigation sans session.
        if (lower == "/health" || lower == "/erreur" || lower.StartsWith("/css/") || lower.StartsWith("/js/") || lower == "/favicon.ico")
        {
            await next(ctx);
            return;
        }
        var session = await sessions.ResolveAsync(ctx);
        current.Session = session;
        if (session is null)
        {
            if (lower == "/login") { await next(ctx); return; }
            ctx.Response.Redirect("/login");
            return;
        }
        if (!session.TotpVerified)
        {
            if (lower is "/totp" or "/logout") { await next(ctx); return; }
            ctx.Response.Redirect("/totp");
            return;
        }
        if (lower is "/login" or "/totp")
        {
            ctx.Response.Redirect("/");
            return;
        }
        await next(ctx);
    }
}
