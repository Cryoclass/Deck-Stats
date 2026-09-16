using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.RateLimiting;
using Testhand.Admin.Data;
using Testhand.Admin.Security;

namespace Testhand.Admin.Pages;

/// <summary>Connexion (docs/backoffice.md §5.1) : même réponse et même coût scrypt que le compte
/// existe, soit admin ou non ; raison de l'échec visible dans le journal seulement.</summary>
[EnableRateLimiting("login")]
public sealed class LoginModel(AccountsRepository accounts, SessionService sessions, AuditService audit) : PageModel
{
    [BindProperty] public string Email { get; set; } = "";
    [BindProperty] public string Password { get; set; } = "";
    public string? Error { get; private set; }

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        var email = (Email ?? "").Trim();
        var password = Password ?? "";
        if (email.Length is 0 or > 254 || password.Length == 0) return await RefusedAsync(null, email, "empty");
        var account = await accounts.FindForLoginAsync(email);
        string? reason = null;
        if (account is null) { await Task.Run(() => PasswordHash.VerifyDummy(password)); reason = "unknown"; }
        else if (account.Role != "admin") { await Task.Run(() => PasswordHash.VerifyDummy(password)); reason = "not-admin"; }
        else if (account.PasswordHash is null) { await Task.Run(() => PasswordHash.VerifyDummy(password)); reason = "no-password"; }
        else if (!await Task.Run(() => PasswordHash.Verify(password, account.PasswordHash))) reason = "bad-password";
        if (reason is not null) return await RefusedAsync(account?.Id, email, reason);
        await sessions.CreateAsync(HttpContext, account!.Id);
        await audit.RecordAsync("login.success", account.Id, account.Email, null);
        return Redirect("/totp");
    }

    private async Task<IActionResult> RefusedAsync(Guid? id, string email, string reason)
    {
        // Journal d'abord, puis la même phrase quelle que soit la raison.
        await audit.RecordAsync("login.failure", id, email, null, new { reason });
        Error = "Identifiants refusés.";
        Password = "";
        return Page();
    }
}
