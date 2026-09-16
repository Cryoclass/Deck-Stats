using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Testhand.Admin.Config;
using Testhand.Admin.Data;
using Testhand.Admin.Security;
using Testhand.Admin.Web;

// Back-office Testhand (docs/backoffice.md). Lecture seule dans ce lot ; se connecte avec le rôle
// PostgreSQL restreint testhand_backoffice (jamais ygo) ; tout vient de l'environnement.
var builder = WebApplication.CreateBuilder(args);
var options = BackofficeOptions.FromEnvironment();
builder.Services.AddSingleton(options);
builder.Services.AddSingleton(TimeProvider.System);  // les tests remplacent l'horloge
builder.Services.AddSingleton(new SecretBox(options.TotpKey));
builder.Services.AddSingleton(Db.CreateDataSource(options.DatabaseUrl));
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<CurrentUser>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<SessionService>();
builder.Services.AddScoped<AccountsRepository>();
builder.Services.AddScoped<DashboardRepository>();
builder.Services.AddScoped<AuditRepository>();
builder.Services.AddScoped<TotpRepository>();
builder.Services.AddRazorPages();
builder.Services.AddRateLimiter(o =>
{
    // T12 : 10 tentatives de connexion par 5 minutes et par adresse ; le GET du formulaire n'est
    // pas compté. Refus 429 journalisé (login.throttled).
    o.AddPolicy("login", ctx => HttpMethods.IsPost(ctx.Request.Method)
        ? RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "?", _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(5),
            QueueLimit = 0,
        })
        : RateLimitPartition.GetNoLimiter("get"));
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        var audit = ctx.HttpContext.RequestServices.GetRequiredService<AuditService>();
        var email = ctx.HttpContext.Request.HasFormContentType ? (await ctx.HttpContext.Request.ReadFormAsync(ct))["Email"].ToString() : "";
        if (email.Length > 254) email = email[..254];
        await audit.RecordAsync("login.throttled", null, email, null, new { reason = "rate-limit" });
        await ctx.HttpContext.Response.WriteAsync("Trop de tentatives de connexion : réessayer dans quelques minutes.", ct);
    };
});

var app = builder.Build();
_ = PasswordHash.Dummy;  // hachage factice calculé maintenant (~0,4 s), pas à la première connexion refusée
if (options.TrustProxy)
{
    // Derrière le Caddy de la stack goldfish (réseau edge), seul chemin d'accès : l'adresse réelle
    // vient de X-Forwarded-For, comme TRUST_PROXY pour le serveur Node.
    var fwd = new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto };
    fwd.KnownIPNetworks.Clear();
    fwd.KnownProxies.Clear();
    app.UseForwardedHeaders(fwd);
}
app.UseExceptionHandler("/erreur");
app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseStaticFiles();
app.UseRouting();
app.UseRateLimiter();
app.UseMiddleware<BackofficeAuthMiddleware>();
app.MapGet("/health", () => Results.Text("ok"));  // sonde Compose : aucun détail, pas une consultation
app.MapRazorPages();
app.Run();

public partial class Program;

