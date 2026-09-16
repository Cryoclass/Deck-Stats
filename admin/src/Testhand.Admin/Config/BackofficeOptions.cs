namespace Testhand.Admin.Config;

/// <summary>Configuration lue dans l'environnement (T14) : rien dans appsettings, rien en dur.</summary>
public sealed class BackofficeOptions
{
    public required string DatabaseUrl { get; init; }
    public required string TotpKey { get; init; }
    /// <summary>« PRODUCTION » ou « DEV » : bandeau permanent (décision 10).</summary>
    public required string EnvironmentLabel { get; init; }
    public bool IsProduction => EnvironmentLabel == "PRODUCTION";
    /// <summary>Cookie Secure hors DEV (le navigateur ne parle qu'en HTTPS à Caddy).</summary>
    public bool SecureCookies => IsProduction;
    public bool TrustProxy { get; init; }
    /// <summary>Hôte public, émetteur du QR TOTP.</summary>
    public required string Host { get; init; }

    public static BackofficeOptions FromEnvironment()
    {
        var url = Environment.GetEnvironmentVariable("BACKOFFICE_DATABASE_URL");
        if (string.IsNullOrWhiteSpace(url)) throw new InvalidOperationException("BACKOFFICE_DATABASE_URL absente : URL PostgreSQL du rôle testhand_backoffice attendue.");
        var key = Environment.GetEnvironmentVariable("BACKOFFICE_TOTP_KEY");
        if (string.IsNullOrWhiteSpace(key)) throw new InvalidOperationException("BACKOFFICE_TOTP_KEY absente : 32 octets en base64 attendus (openssl rand -base64 32).");
        var env = (Environment.GetEnvironmentVariable("BACKOFFICE_ENV") ?? "DEV").Trim().ToUpperInvariant();
        if (env is not ("PRODUCTION" or "DEV")) throw new InvalidOperationException($"BACKOFFICE_ENV = « {env} » : PRODUCTION ou DEV attendu.");
        return new BackofficeOptions
        {
            DatabaseUrl = url.Trim(),
            TotpKey = key.Trim(),
            EnvironmentLabel = env,
            TrustProxy = Environment.GetEnvironmentVariable("BACKOFFICE_TRUST_PROXY") == "1",
            Host = (Environment.GetEnvironmentVariable("BACKOFFICE_HOST") ?? "localhost").Trim(),
        };
    }
}
