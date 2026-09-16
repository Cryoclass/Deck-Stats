using Testhand.Admin.Data;

namespace Testhand.Admin.Web;

/// <summary>Session de la requête courante, posée par BackofficeAuthMiddleware (T7).</summary>
public sealed class CurrentUser
{
    public BackofficeSession? Session { get; set; }
    public bool IsAuthenticated => Session is { TotpVerified: true };

    /// <summary>Dans une page derrière la garde, la session est garantie présente et TOTP validé.</summary>
    public BackofficeSession Require() => IsAuthenticated ? Session! : throw new InvalidOperationException("Page appelée hors de la garde du back-office.");
}
