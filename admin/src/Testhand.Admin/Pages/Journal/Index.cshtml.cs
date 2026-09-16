using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Testhand.Admin.Data;
using Testhand.Admin.Web;

namespace Testhand.Admin.Pages.Journal;

public sealed class IndexModel(AuditRepository auditRepo, AuditService audit, CurrentUser current) : PageModel
{
    [BindProperty(SupportsGet = true, Name = "action")] public string Action { get; set; } = "";
    [BindProperty(SupportsGet = true, Name = "acteur")] public string Acteur { get; set; } = "";
    [BindProperty(SupportsGet = true, Name = "cible")] public string Cible { get; set; } = "";
    [BindProperty(SupportsGet = true, Name = "du")] public string Du { get; set; } = "";
    [BindProperty(SupportsGet = true, Name = "au")] public string Au { get; set; } = "";
    [BindProperty(SupportsGet = true, Name = "p")] public int PageNumber { get; set; } = 1;  // « page » est réservé par Razor Pages
    public IReadOnlyList<string> Actions { get; private set; } = [];
    public AuditPage Result { get; private set; } = null!;
    public string? FilterError { get; private set; }

    public async Task OnGetAsync()
    {
        var me = current.Require();
        Action = (Action ?? "").Trim(); if (Action.Length > 64) Action = Action[..64];
        Acteur = (Acteur ?? "").Trim(); if (Acteur.Length > 100) Acteur = Acteur[..100];
        Cible = (Cible ?? "").Trim(); if (Cible.Length > 36) Cible = Cible[..36];
        Du = (Du ?? "").Trim(); if (Du.Length > 10) Du = Du[..10];
        Au = (Au ?? "").Trim(); if (Au.Length > 10) Au = Au[..10];
        PageNumber = Math.Clamp(PageNumber, 1, 100_000);
        Guid? target = null;
        if (Cible.Length > 0) { if (Guid.TryParse(Cible, out var g)) target = g; else FilterError = "Cible ignorée : un identifiant de compte (UUID) est attendu."; }
        DateTimeOffset? from = ParseDay(Du), to = ParseDay(Au)?.AddDays(1);
        if ((Du.Length > 0 && from is null) || (Au.Length > 0 && to is null)) FilterError = "Dates ignorées : format AAAA-MM-JJ attendu.";
        await audit.RecordAsync("view.audit", me.UserId, me.Email, target, new { action = Action, actor = Acteur, from = Du, to = Au, page = PageNumber });
        Actions = await auditRepo.ActionsAsync();
        Result = await auditRepo.ListAsync(new AuditFilter(Action, Acteur, target, from, to, PageNumber));
    }

    private static DateTimeOffset? ParseDay(string s) =>
        DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d)
            ? new DateTimeOffset(d, TimeSpan.Zero) : null;
}
