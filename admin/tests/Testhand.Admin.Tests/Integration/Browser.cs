using System.Text.RegularExpressions;

namespace Testhand.Admin.Tests.Integration;

/// <summary>Client minimal à cookies et jeton antiforgery, sans suivi des redirections : chaque
/// 302 est une assertion. Le jeton antiforgery pris est le DERNIER de la page (le gabarit rend
/// d'abord le formulaire de déconnexion).</summary>
public sealed partial class Browser(HttpClient http)
{
    public Dictionary<string, string> Cookies { get; } = new();
    public string? SessionCookie => Cookies.GetValueOrDefault("th_backoffice");

    public Task<HttpResponseMessage> GetAsync(string path) => SendAsync(new HttpRequestMessage(HttpMethod.Get, path));

    public async Task<HttpResponseMessage> PostFormAsync(string path, Dictionary<string, string> fields)
    {
        var page = await GetAsync(path);
        var html = await page.Content.ReadAsStringAsync();
        var token = TokenRegex().Matches(html).LastOrDefault()?.Groups[1].Value
            ?? throw new InvalidOperationException($"aucun jeton antiforgery sur {path} ({(int)page.StatusCode})");
        fields["__RequestVerificationToken"] = token;
        return await SendAsync(new HttpRequestMessage(HttpMethod.Post, path) { Content = new FormUrlEncodedContent(fields) });
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req)
    {
        if (Cookies.Count > 0) req.Headers.Add("Cookie", string.Join("; ", Cookies.Select(kv => $"{kv.Key}={kv.Value}")));
        var res = await http.SendAsync(req);
        if (res.Headers.TryGetValues("Set-Cookie", out var set))
            foreach (var sc in set)
            {
                var first = sc.Split(';')[0];
                var eq = first.IndexOf('=');
                if (eq <= 0) continue;
                var name = first[..eq];
                var value = first[(eq + 1)..];
                if (value.Length == 0 || sc.Contains("expires=Thu, 01 Jan 1970", StringComparison.OrdinalIgnoreCase)) Cookies.Remove(name);
                else Cookies[name] = value;
            }
        return res;
    }

    [GeneratedRegex("name=\"__RequestVerificationToken\" type=\"hidden\" value=\"([^\"]+)\"")]
    private static partial Regex TokenRegex();
}
