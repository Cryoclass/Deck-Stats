using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Testhand.Admin.Pages;

[ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
public sealed class ErreurModel : PageModel
{
    public void OnGet() => Response.StatusCode = StatusCodes.Status500InternalServerError;
}
