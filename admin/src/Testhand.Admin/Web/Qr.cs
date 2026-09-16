using System.Text;
using QRCoder;

namespace Testhand.Admin.Web;

/// <summary>QR d'enrôlement rendu en SVG à partir de la matrice de modules de QRCoder : un seul
/// chemin, aucun attribut de style (compatible avec la CSP sans inline), couleur héritée du texte.</summary>
public static class Qr
{
    public static string Svg(string content)
    {
        using var gen = new QRCodeGenerator();
        using var data = gen.CreateQrCode(content, QRCodeGenerator.ECCLevel.M);
        var m = data.ModuleMatrix;
        var n = m.Count;
        var d = new StringBuilder();
        for (var y = 0; y < n; y++)
            for (var x = 0; x < n; x++)
                if (m[y][x]) d.Append("M").Append(x).Append(' ').Append(y).Append("h1v1h-1z");
        return $"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {n} {n}\" shape-rendering=\"crispEdges\" role=\"img\" aria-label=\"QR d'enrôlement\"><path fill=\"currentColor\" d=\"{d}\"/></svg>";
    }
}
