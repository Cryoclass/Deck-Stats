namespace Testhand.Admin.Web;

/// <summary>En-têtes posés par l'app elle-même (T10), quel que soit le proxy devant : CSP stricte
/// sans inline (le thème est un fichier), nosniff, aucun referrer, noindex, jamais dans un cadre,
/// aucune mise en cache. HSTS reste au Caddy qui termine TLS.</summary>
public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public const string Csp = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'";

    public Task Invoke(HttpContext ctx)
    {
        var h = ctx.Response.Headers;
        h["Content-Security-Policy"] = Csp;
        h["X-Content-Type-Options"] = "nosniff";
        h["Referrer-Policy"] = "no-referrer";
        h["X-Robots-Tag"] = "noindex, nofollow";
        h["X-Frame-Options"] = "DENY";
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
        h["Cache-Control"] = ctx.Request.Path.StartsWithSegments("/css") || ctx.Request.Path.StartsWithSegments("/js") ? "private, max-age=3600" : "no-store";
        return next(ctx);
    }
}
