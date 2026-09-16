using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Testhand.Admin.Security;

namespace Testhand.Admin.Tests.Security;

/// <summary>Session absolue de 8 h, jamais glissante ; jeton base64url ; empreinte SHA-256.</summary>
public class SessionPolicyTests
{
    private static readonly DateTimeOffset Created = new(2026, 9, 16, 10, 4, 0, TimeSpan.Zero);

    [Fact]
    public void Lifetime_HuitHeuresExactes()
    {
        Assert.Equal(TimeSpan.FromHours(8), SessionPolicy.Lifetime);
        Assert.Equal(Created.AddHours(8), SessionPolicy.ExpiresAt(Created));
    }

    [Fact]
    public void ExpiresAt_ConserveLeDecalageHoraire()
    {
        var local = new DateTimeOffset(2026, 9, 16, 12, 0, 0, TimeSpan.FromHours(2));

        Assert.Equal(local.AddHours(8), SessionPolicy.ExpiresAt(local));
        Assert.Equal(local.ToUniversalTime().AddHours(8), SessionPolicy.ExpiresAt(local).ToUniversalTime());
    }

    [Fact]
    public void IsExpired_ALaSecondePres()
    {
        DateTimeOffset expiresAt = SessionPolicy.ExpiresAt(Created);

        Assert.False(SessionPolicy.IsExpired(expiresAt, Created));
        Assert.False(SessionPolicy.IsExpired(expiresAt, expiresAt.AddSeconds(-1)));
        Assert.False(SessionPolicy.IsExpired(expiresAt, expiresAt.AddTicks(-1)));
        Assert.True(SessionPolicy.IsExpired(expiresAt, expiresAt));
        Assert.True(SessionPolicy.IsExpired(expiresAt, expiresAt.AddSeconds(1)));
    }

    [Fact]
    public void AucuneFonctionDeProlongation()
    {
        // La politique est absolue : aucune API ne renvoie une nouvelle expiration à partir d'une
        // activité ; seule ExpiresAt(createdAt) existe et elle ne dépend que de la création.
        string[] members = typeof(SessionPolicy)
            .GetMembers(BindingFlags.Public | BindingFlags.Static)
            .Select(m => m.Name)
            .Where(n => !n.StartsWith("get_", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(["ExpiresAt", "IsExpired", "Lifetime", "NewToken", "TokenBytes", "TokenHash"], members);
        Assert.DoesNotContain(members, n => n.Contains("Extend", StringComparison.OrdinalIgnoreCase)
                                          || n.Contains("Slide", StringComparison.OrdinalIgnoreCase)
                                          || n.Contains("Renew", StringComparison.OrdinalIgnoreCase)
                                          || n.Contains("Refresh", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void NewToken_43CaracteresBase64Url_Uniques()
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < 100; i++)
        {
            string token = SessionPolicy.NewToken();

            Assert.Equal(43, token.Length);
            Assert.Matches("^[A-Za-z0-9_-]{43}$", token);
            Assert.Equal(32, System.Buffers.Text.Base64Url.DecodeFromChars(token).Length);
            Assert.True(seen.Add(token));
        }
    }

    [Fact]
    public void TokenHash_Sha256Stable()
    {
        string token = SessionPolicy.NewToken();

        byte[] a = SessionPolicy.TokenHash(token);
        byte[] b = SessionPolicy.TokenHash(token);

        Assert.Equal(32, a.Length);
        Assert.Equal(a, b);
        Assert.Equal(SHA256.HashData(Encoding.UTF8.GetBytes(token)), a);
        Assert.NotEqual(a, SessionPolicy.TokenHash(SessionPolicy.NewToken()));
    }

    [Fact]
    public void TokenHash_VecteurConnu()
    {
        // SHA-256("abc"), FIPS 180-2.
        Assert.Equal(
            Hex.Bytes("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
            SessionPolicy.TokenHash("abc"));
    }
}
