using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Testhand.Admin.Data;
using Testhand.Admin.Web;

namespace Testhand.Admin.Pages;

/// <summary>Déconnexion par POST seulement (jeton antiforgery) : session supprimée, cookie effacé, journal.</summary>
public sealed class LogoutModel(SessionService sessions, AuditService audit, CurrentUser current) : PageModel
{
    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        if (current.Session is { } s)
        {
            await audit.RecordAsync("logout", s.UserId, s.Email, null, new { totpVerified = s.TotpVerified });
            await sessions.DestroyAsync(HttpContext, s);
        }
        return Redirect("/login");
    }
}
