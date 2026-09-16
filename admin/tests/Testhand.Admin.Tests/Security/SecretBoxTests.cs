using System.Security.Cryptography;
using Testhand.Admin.Security;

namespace Testhand.Admin.Tests.Security;

/// <summary>AES-256-GCM du secret TOTP : aller-retour, altération détectée, clé refusée.</summary>
public class SecretBoxTests
{
    private static string NewKey() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    [Fact]
    public void Seal_Open_AllerRetour()
    {
        using var box = new SecretBox(NewKey());
        byte[] secret = RandomNumberGenerator.GetBytes(20);

        byte[] sealedValue = box.Seal(secret);

        Assert.Equal(12 + 16 + 20, sealedValue.Length);
        Assert.Equal(secret, box.Open(sealedValue));
    }

    [Fact]
    public void Seal_NonceDifferentAChaqueAppel()
    {
        using var box = new SecretBox(NewKey());
        byte[] secret = RandomNumberGenerator.GetBytes(20);

        byte[] a = box.Seal(secret);
        byte[] b = box.Seal(secret);

        Assert.NotEqual(a.AsSpan(0, 12).ToArray(), b.AsSpan(0, 12).ToArray());
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void Seal_ClairVide()
    {
        using var box = new SecretBox(NewKey());

        byte[] sealedValue = box.Seal([]);

        Assert.Equal(28, sealedValue.Length);
        Assert.Empty(box.Open(sealedValue));
    }

    [Theory]
    [InlineData(0)]   // nonce
    [InlineData(12)]  // étiquette
    [InlineData(28)]  // chiffré
    public void Open_DetecteUneAlteration(int index)
    {
        using var box = new SecretBox(NewKey());
        byte[] sealedValue = box.Seal(RandomNumberGenerator.GetBytes(20));
        sealedValue[index] ^= 0x01;

        Assert.Throws<AuthenticationTagMismatchException>(() => box.Open(sealedValue));
    }

    [Fact]
    public void Open_RefuseUneValeurTronquee()
    {
        using var box = new SecretBox(NewKey());
        byte[] sealedValue = box.Seal(RandomNumberGenerator.GetBytes(20));

        Assert.Throws<CryptographicException>(() => box.Open(sealedValue.AsSpan(0, 27).ToArray()));
        Assert.Throws<CryptographicException>(() => box.Open([]));
    }

    [Fact]
    public void Open_RefuseUneAutreCle()
    {
        using var a = new SecretBox(NewKey());
        using var b = new SecretBox(NewKey());
        byte[] sealedValue = a.Seal(RandomNumberGenerator.GetBytes(20));

        Assert.Throws<AuthenticationTagMismatchException>(() => b.Open(sealedValue));
    }

    [Theory]
    [InlineData(null, "absente")]
    [InlineData("", "absente")]
    [InlineData("   ", "absente")]
    [InlineData("pas du base64 !", "base64")]
    [InlineData("AAAA", "32 octets")]
    public void Constructeur_RefuseUneCleAbsenteIllisibleOuDeMauvaiseLongueur(string? key, string expectedInMessage)
    {
        var e = Assert.Throws<ArgumentException>(() => new SecretBox(key));

        Assert.Contains("BACKOFFICE_TOTP_KEY", e.Message);
        Assert.Contains(expectedInMessage, e.Message);
    }

    [Theory]
    [InlineData(16)]
    [InlineData(24)]
    [InlineData(31)]
    [InlineData(33)]
    [InlineData(64)]
    public void Constructeur_RefuseUneCleDUneAutreLongueur(int length)
    {
        string key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(length));

        var e = Assert.Throws<ArgumentException>(() => new SecretBox(key));

        Assert.Contains($"reçu {length}", e.Message);
    }
}
