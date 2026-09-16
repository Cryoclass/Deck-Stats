using System.Globalization;

namespace Testhand.Admin.Web;

/// <summary>Formats factuels (docs/design-backoffice.md §1) : dates ISO en UTC, « — » pour ce
/// que la base ne sait pas, identifiants tronqués avec le complet en infobulle.</summary>
public static class Fmt
{
    public static string Date(DateTimeOffset? d) => d is { } v ? v.ToUniversalTime().ToString("yyyy-MM-dd HH:mm 'UTC'", CultureInfo.InvariantCulture) : "—";
    public static string DateShort(DateTimeOffset? d) => d is { } v ? v.ToUniversalTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "—";
    public static string Num(long n) => n.ToString("N0", CultureInfo.GetCultureInfo("fr-FR")).Replace(' ', ' ').Replace(' ', ' ');
    public static string ShortId(Guid? id) => id is { } g ? g.ToString("D")[..8] + "…" : "—";
    public static string Text(string? s) => string.IsNullOrEmpty(s) ? "—" : s;
    public static string Ua(string? ua)
    {
        if (string.IsNullOrEmpty(ua)) return "—";
        return ua.Length > 60 ? ua[..60] + "…" : ua;
    }
}
