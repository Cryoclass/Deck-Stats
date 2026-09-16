using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Testhand.Admin.Security;
using Xunit.Abstractions;

namespace Testhand.Admin.Tests.Security;

/// <summary>Vecteurs de la RFC 7914 : §8 (Salsa20/8), §9 (BlockMix), §10 (ROMix), §11 (PBKDF2), §12 (scrypt).</summary>
public class ScryptTests(ITestOutputHelper output)
{
    [Fact]
    public void Salsa20Core8_VecteurRfc7914_Section8()
    {
        uint[] input = Hex.WordsLittleEndian(@"
            7e879a214f3ec9867ca940e641718f26 baee555b8c61c1b50df846116dcd3b1d
            ee24f319df9b3d8514121e4b5ac5aa32 76021d2909c74829edebc68db8b8c25e");
        uint[] expected = Hex.WordsLittleEndian(@"
            a41f859c6608cc993b81cacb020cef05 044b2181a2fd337dfd7b1c6396682f29
            b4393168e3c9e6bcfe6bc5b7a06d96ba e424cc102c91745c24ad673dc7618f81");

        Scrypt.Salsa20Core8(input);

        Assert.Equal(expected, input);
    }

    [Fact]
    public void BlockMix_VecteurRfc7914_Section9()
    {
        uint[] input = Hex.WordsLittleEndian(@"
            f7ce0b653d2d72a4108cf5abe912ffdd 777616dbbb27a70e8204f3ae2d0f6fad
            89f68f4811d1e87bcc3bd7400a9ffd29 094f0184639574f39ae5a1315217bcd7
            894991447213bb226c25b54da86370fb cd984380374666bb8ffcb5bf40c254b0
            67d27c51ce4ad5fed829c90b505a571b 7f4d1cad6a523cda770e67bceaaf7e89");
        uint[] expected = Hex.WordsLittleEndian(@"
            a41f859c6608cc993b81cacb020cef05 044b2181a2fd337dfd7b1c6396682f29
            b4393168e3c9e6bcfe6bc5b7a06d96ba e424cc102c91745c24ad673dc7618f81
            20edc975323881a80540f64c162dcd3c 21077cfe5f8d5fe2b1a4168f953678b7
            7d3b3d803b60e4ab920996e59b4d53b6 5d2a225877d5edf5842cb9f14eefe425");
        uint[] result = new uint[32];

        Scrypt.BlockMix(input, result, new uint[16], r: 1);

        Assert.Equal(expected, result);
    }

    [Fact]
    public void ROMix_VecteurRfc7914_Section10()
    {
        uint[] block = Hex.WordsLittleEndian(@"
            f7ce0b653d2d72a4108cf5abe912ffdd 777616dbbb27a70e8204f3ae2d0f6fad
            89f68f4811d1e87bcc3bd7400a9ffd29 094f0184639574f39ae5a1315217bcd7
            894991447213bb226c25b54da86370fb cd984380374666bb8ffcb5bf40c254b0
            67d27c51ce4ad5fed829c90b505a571b 7f4d1cad6a523cda770e67bceaaf7e89");
        uint[] expected = Hex.WordsLittleEndian(@"
            79ccc193629debca047f0b70604bf6b6 2ce3dd4a9626e355fafc6198e6ea2b46
            d58413673b99b029d665c357601fb426 a0b2f4bba200ee9f0a43d19b571a9c71
            ef1142e65d5a266fddca832ce59faa7c ac0b9cf1be2bffca300d01ee387619c4
            ae12fd4438f203a0e4e1c47ec314861f 4e9087cb33396a6873e8f9d2539a4b8e");

        Scrypt.ROMix(block, new uint[16 * 32], new uint[32], new uint[32], new uint[16], n: 16, r: 1);

        Assert.Equal(expected, block);
    }

    [Fact]
    public void Pbkdf2HmacSha256_VecteurRfc7914_Section11()
    {
        // Sanity check du PBKDF2 natif utilisé par DeriveKey (P = "passwd", S = "salt", c = 1, 64 octets).
        byte[] expected = Hex.Bytes(@"
            55ac046e56e3089fec1691c22544b605 f94185216dde0465e68b9d57c20dacbc
            49ca9cccf179b645991664b39d77ef31 7c71b845b1e30bd509112041d3a19783");

        byte[] dk = Rfc2898DeriveBytes.Pbkdf2("passwd"u8.ToArray(), "salt"u8.ToArray(), 1, HashAlgorithmName.SHA256, 64);

        Assert.Equal(expected, dk);
    }

    // §12 : les trois premiers vecteurs. Le 4e (N = 2^20, r = 8, p = 1 : 1 Gio de mémoire) n'est
    // pas joué ; il dépasse d'ailleurs le plafond par défaut de 512 Mio (vérifié plus bas).
    public static TheoryData<string, string, int, int, int, string> Rfc7914Section12 => new()
    {
        {
            "", "", 16, 1, 1,
            @"77d6576238657b203b19ca42c18a0497 f16b4844e3074ae8dfdffa3fede21442
              fcd0069ded0948f8326a753a0fc81f17 e8d3e0fb2e0d3628cf35e20c38d18906"
        },
        {
            "password", "NaCl", 1024, 8, 16,
            @"fdbabe1c9d3472007856e7190d01e9fe 7c6ad7cbc8237830e77376634b373162
              2eaf30d92e22a3886ff109279d9830da c727afb94a83ee6d8360cbdfa2cc0640"
        },
        {
            "pleaseletmein", "SodiumChloride", 16384, 8, 1,
            @"7023bdcb3afd7348461c06cd81fd38eb fda8fbba904f8e3ea9b543f6545da1f2
              d5432955613f0fcf62d49705242a9af9 e61e85dc0d651e40dfcf017b45575887"
        },
    };

    [Theory]
    [MemberData(nameof(Rfc7914Section12))]
    public void DeriveKey_VecteursRfc7914_Section12(string password, string salt, int n, int r, int p, string expectedHex)
    {
        byte[] dk = Scrypt.DeriveKey(Encoding.ASCII.GetBytes(password), Encoding.ASCII.GetBytes(salt), n, r, p, 64);

        Assert.Equal(Hex.Bytes(expectedHex), dk);
    }

    [Fact]
    public void Vecteur4_AuDelaDuPlafondParDefaut()
    {
        // N = 2^20, r = 8 → 1 Gio > 512 Mio : refusé sans allocation.
        Assert.False(Scrypt.IsValidParameters(1 << 20, 8, 1, 64));
        Assert.Throws<ArgumentException>(() => Scrypt.DeriveKey([], [], 1 << 20, 8, 1, 64));
    }

    [Theory]
    [InlineData(0, 8, 1, 64)]      // N nul
    [InlineData(1, 8, 1, 64)]      // N = 1
    [InlineData(1000, 8, 1, 64)]   // N pas une puissance de deux
    [InlineData(16, 0, 1, 64)]     // r nul
    [InlineData(16, 1, 0, 64)]     // p nul
    [InlineData(16, 1, 1, 0)]      // dkLen nul
    [InlineData(65536, 1, 1, 64)]  // N ≥ 2^(16·r) pour r = 1
    [InlineData(-16, 8, 1, 64)]    // négatif
    public void IsValidParameters_RefuseLesParametresInvalides(int n, int r, int p, int dkLen)
    {
        Assert.False(Scrypt.IsValidParameters(n, r, p, dkLen));
        Assert.Throws<ArgumentException>(() => Scrypt.DeriveKey([1], [2], n, r, p, dkLen));
    }

    [Fact]
    public void IsValidParameters_AccepteLesParametresDuServeur()
    {
        Assert.True(Scrypt.IsValidParameters(1 << 17, 8, 1, 64));
        Assert.Equal(128L * 1024 * 1024, Scrypt.MemoryBytes(1 << 17, 8));
    }

    [Fact]
    public void DeriveKey_LongueurDemandeeRespectee()
    {
        byte[] a = Scrypt.DeriveKey("p"u8.ToArray(), "s"u8.ToArray(), 16, 1, 1, 17);
        byte[] b = Scrypt.DeriveKey("p"u8.ToArray(), "s"u8.ToArray(), 16, 1, 1, 100);

        Assert.Equal(17, a.Length);
        Assert.Equal(100, b.Length);
        // PBKDF2 final : la clé courte est un préfixe de la longue (même B intermédiaire).
        Assert.Equal(a, b.Take(17));
    }

    [Fact]
    public void Chronometre_N2p17_r8_p1_Release()
    {
        // Sans assertion de temps : mesure imprimée pour le rapport (cible ≈ moins de 1,5 s en Release).
        byte[] password = Encoding.UTF8.GetBytes("mesure");
        byte[] salt = RandomNumberGenerator.GetBytes(16);
        Scrypt.DeriveKey(password, salt, 1 << 14, 8, 1, 64); // échauffement (JIT)

        var sw = Stopwatch.StartNew();
        byte[] dk = Scrypt.DeriveKey(password, salt, 1 << 17, 8, 1, 64);
        sw.Stop();

        Assert.Equal(64, dk.Length);
        output.WriteLine($"scrypt N=2^17 r=8 p=1 dkLen=64 : {sw.Elapsed.TotalMilliseconds:F0} ms ({(Debugger.IsAttached ? "débogueur" : "sans débogueur")})");
    }
}
