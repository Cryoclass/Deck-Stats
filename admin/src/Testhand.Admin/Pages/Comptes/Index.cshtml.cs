using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Testhand.Admin.Data;
using Testhand.Admin.Web;

namespace Testhand.Admin.Pages.Comptes;

public sealed class IndexModel(AccountsRepository accounts, AuditService audit, CurrentUser current) : PageModel
{
    [BindProperty(SupportsGet = true, Name = "q")] public string Q { get; set; } = "";
    [BindProperty(SupportsGet = true, Name = "tri")] public string Sort { get; set; } = "email";
    [BindProperty(SupportsGet = true, Name = "sens")] public string Sens { get; set; } = "asc";
    [BindProperty(SupportsGet = true, Name = "p")] public int PageNumber { get; set; } = 1;  // « page » est réservé par Razor Pages
    public bool Desc => Sens == "desc";
    public AccountsPage Result { get; private set; } = null!;

    public async Task OnGetAsync()
    {
        var me = current.Require();
        Q = (Q ?? "").Trim();
        if (Q.Length > 100) Q = Q[..100];
        if (!AccountsRepository.SortColumns.ContainsKey(Sort ?? "")) Sort = "email";
        Sens = Sens == "desc" ? "desc" : "asc";
        PageNumber = Math.Clamp(PageNumber, 1, 100_000);
        await audit.RecordAsync("view.accounts", me.UserId, me.Email, null, new { q = Q, sort = Sort, dir = Sens, page = PageNumber });
        Result = await accounts.ListAsync(Q, Sort!, Desc, PageNumber);
    }
}
