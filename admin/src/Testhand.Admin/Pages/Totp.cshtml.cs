using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Testhand.Admin.Config;
using Testhand.Admin.Data;
using Testhand.Admin.Security;
using Testhand.Admin.Web;

namespace Testhand.Admin.Pages;

/// <summary>Second facteur (docs/backoffice.md §5.2) : enrôlement au premier accès (QR + base32,
/// confirmé par le premier code juste), puis vérification ± 1 pas avec anti-rejeu.</summary>
public sealed class TotpModel(TotpRepository totp, SecretBox box, SessionService sessions, CurrentUser current, AuditService audit, TimeProvider clock, BackofficeOptions options) : PageModel
{
    [BindProperty] public string Code { get; set; } = "";
    public bool Enrolling { get; private set; }
    public string? QrSvg { get; private set; }
    public string? SecretGroups { get; private set; }
    public string? Error { get; private set; }

    private BackofficeSession Me => current.Session ?? throw new InvalidOperationException("Session attendue par la garde.");

    public async Task OnGetAsync() => await PrepareAsync();

    public async Task<IActionResult> OnPostAsync()
    {
        var me = Me;
        var row = await totp.GetAsync(me.UserId);
        if (row is null) { await PrepareAsync(); return Page(); }
        var secret = box.Open(row.SecretEnc);
        var now = Totp.Counter(clock.GetUtcNow());
        if (Totp.Verify(secret, (Code ?? "").Trim(), now, row.LastCounter, out var accepted) && await totp.AcceptAsync(me.UserId, accepted, confirm: row.ConfirmedAt is null))
        {
            var first = row.ConfirmedAt is null;
            if (first) await audit.RecordAsync("totp.enrol", me.UserId, me.Email, null);
            await sessions.MarkTotpVerifiedAsync(me.TokenHash);
            await audit.RecordAsync("totp.success", me.UserId, me.Email, null);
            return Redirect("/");
        }
        await audit.RecordAsync("totp.failure", me.UserId, me.Email, null, new { reason = row.ConfirmedAt is null ? "enrolment" : "bad-code-or-replayed" });
        Error = "Code refusé.";
        await PrepareAsync();
        return Page();
    }

    private async Task PrepareAsync()
    {
        var me = Me;
        var row = await totp.GetAsync(me.UserId);
        if (row is { ConfirmedAt: not null }) return;
        byte[] secret;
        if (row is null)
        {
            secret = RandomNumberGenerator.GetBytes(20);
            await totp.BeginEnrolmentAsync(me.UserId, box.Seal(secret));
        }
        else secret = box.Open(row.SecretEnc);  // enrôlement commencé, non confirmé : même secret
        Enrolling = true;
        var b32 = Base32.Encode(secret);
        SecretGroups = string.Join(' ', Enumerable.Range(0, (b32.Length + 3) / 4).Select(i => b32.Substring(i * 4, Math.Min(4, b32.Length - i * 4))));
        // Émetteur = hôte sans port (un « : » est interdit dans le libellé otpauth).
        QrSvg = Qr.Svg(TotpUri.Build("Testhand " + options.Host.Split(':')[0], me.Email, secret));
    }
}
