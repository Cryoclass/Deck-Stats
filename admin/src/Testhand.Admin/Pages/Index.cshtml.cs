using Microsoft.AspNetCore.Mvc.RazorPages;
using Testhand.Admin.Data;
using Testhand.Admin.Web;

namespace Testhand.Admin.Pages;

public sealed class IndexModel(DashboardRepository dashboard, AuditService audit, CurrentUser current) : PageModel
{
    public Dashboard Data { get; private set; } = null!;

    public async Task OnGetAsync()
    {
        var me = current.Require();
        await audit.RecordAsync("view.dashboard", me.UserId, me.Email, null);
        Data = await dashboard.LoadAsync();
    }
}
