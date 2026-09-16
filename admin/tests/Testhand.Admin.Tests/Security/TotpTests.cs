using System.Text;
using Testhand.Admin.Security;

namespace Testhand.Admin.Tests.Security;

/// <summary>RFC 6238 annexe B (SHA-1), RFC 4226 annexe D, fenêtre et anti-rejeu.</summary>
public class TotpTests
{
    // Secret ASCII de la RFC : "12345678901234567890".
    private static readonly byte[] Secret = Encoding.ASCII.GetBytes("12345678901234567890");

    [Theory]
    [InlineData(59L, "94287082")]
    [InlineData(1111111109L, "07081804")]
    [InlineData(1111111111L, "14050471")]
    [InlineData(1234567890L, "89005924")]
    [InlineData(2000000000L, "69279037")]
    [InlineData(20000000000L, "65353130")]
    public void Code_VecteursRfc6238_AnnexeB_Sha1(long unixSeconds, string expected)
    {
        long counter = Totp.Counter(DateTimeOffset.FromUnixTimeSeconds(unixSeconds));

        Assert.Equal(expected, Totp.Code(Secret, counter, digits: 8));
    }

    [Theory]
    [InlineData(0, "755224")]
    [InlineData(1, "287082")]
    [InlineData(2, "359152")]
    [InlineData(3, "969429")]
    [InlineData(4, "338314")]
    [InlineData(5, "254676")]
    [InlineData(6, "287922")]
    [InlineData(7, "162583")]
    [InlineData(8, "399871")]
    [InlineData(9, "520489")]
    public void Code_VecteursRfc4226_AnnexeD_SixChiffres(long counter, string expected)
    {
        Assert.Equal(expected, Totp.Code(Secret, counter));
    }

    [Theory]
    [InlineData(0L, 0L)]
    [InlineData(29L, 0L)]
    [InlineData(30L, 1L)]
    [InlineData(59L, 1L)]
    [InlineData(1111111109L, 0x23523EC)]
    [InlineData(20000000000L, 0x27BC86AA)]
    [InlineData(-1L, -1L)]
    public void Counter_PasDe30Secondes(long unixSeconds, long expected)
    {
        Assert.Equal(expected, Totp.Counter(DateTimeOffset.FromUnixTimeSeconds(unixSeconds)));
    }

    [Fact]
    public void Verify_AccepteLePasCourant_EtRenvoieLePas()
    {
        const long now = 1000;
        string code = Totp.Code(Secret, now);

        Assert.True(Totp.Verify(Secret, code, now, lastAcceptedCounter: 0, out long accepted));
        Assert.Equal(now, accepted);
    }

    [Fact]
    public void Verify_FenetrePlusOuMoinsUnPas()
    {
        const long now = 1000;

        Assert.True(Totp.Verify(Secret, Totp.Code(Secret, now - 1), now, 0, out long a));
        Assert.Equal(now - 1, a);
        Assert.True(Totp.Verify(Secret, Totp.Code(Secret, now + 1), now, 0, out long b));
        Assert.Equal(now + 1, b);
        Assert.False(Totp.Verify(Secret, Totp.Code(Secret, now - 2), now, 0, out _));
        Assert.False(Totp.Verify(Secret, Totp.Code(Secret, now + 2), now, 0, out _));
    }

    [Fact]
    public void Verify_FenetreParametrable()
    {
        const long now = 1000;

        Assert.True(Totp.Verify(Secret, Totp.Code(Secret, now - 2), now, 0, out _, window: 2));
        Assert.False(Totp.Verify(Secret, Totp.Code(Secret, now - 1), now, 0, out _, window: 0));
        Assert.True(Totp.Verify(Secret, Totp.Code(Secret, now), now, 0, out _, window: 0));
    }

    [Fact]
    public void Verify_AntiRejeu_RefuseToutPasDejaAccepte()
    {
        const long now = 1000;
        string code = Totp.Code(Secret, now);

        Assert.True(Totp.Verify(Secret, code, now, 0, out long first));
        // Le même code, rejoué : le pas est ≤ dernier accepté.
        Assert.False(Totp.Verify(Secret, code, now, first, out long unchanged));
        Assert.Equal(first, unchanged);
        // Le pas précédent, encore dans la fenêtre, est lui aussi refusé.
        Assert.False(Totp.Verify(Secret, Totp.Code(Secret, now - 1), now, first, out _));
        // Le pas suivant reste acceptable.
        Assert.True(Totp.Verify(Secret, Totp.Code(Secret, now + 1), now, first, out long next));
        Assert.Equal(now + 1, next);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("12345")]
    [InlineData("1234567")]
    [InlineData("12345a")]
    [InlineData("123 45")]
    [InlineData("１２３４５６")] // chiffres pleine chasse
    [InlineData("+12345")]
    public void Verify_RefuseUnCodeNonNumeriqueOuDeMauvaiseLongueur(string? code)
    {
        Assert.False(Totp.Verify(Secret, code, 1000, 0, out long accepted));
        Assert.Equal(0, accepted);
    }

    [Fact]
    public void Verify_MauvaisSecret()
    {
        byte[] other = Encoding.ASCII.GetBytes("09876543210987654321");

        Assert.False(Totp.Verify(other, Totp.Code(Secret, 1000), 1000, 0, out _));
    }

    [Fact]
    public void Code_ComplèteParDesZeros()
    {
        // 1111111109 → 07081804 sur 8 chiffres : le zéro de tête est conservé.
        Assert.Equal("07081804", Totp.Code(Secret, 0x23523EC, 8));
        Assert.Equal(6, Totp.Code(Secret, 0x23523EC).Length);
    }
}
