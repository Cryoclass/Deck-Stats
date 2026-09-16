using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Testhand.Admin.Data;
using Testhand.Admin.Web;

namespace Testhand.Admin.Pages.Comptes;

public sealed class DetailModel(AccountsRepository accounts, AuditService audit, CurrentUser current) : PageModel
{
    public AccountRow Account { get; private set; } = null!;
    public IReadOnlyList<AccountSession> Sessions { get; private set; } = [];

    public async Task<IActionResult> OnGetAsync(Guid id)
    {
        var me = current.Require();
        await audit.RecordAsync("view.account", me.UserId, me.Email, id);
        var a = await accounts.GetAsync(id);
        if (a is null) return NotFound();
        Account = a;
        Sessions = await accounts.ActiveSessionsAsync(id);
        return Page();
    }
}
