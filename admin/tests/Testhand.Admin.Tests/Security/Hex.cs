namespace Testhand.Admin.Tests.Security;

/// <summary>Lecture des vecteurs hexadécimaux des RFC, espaces et retours à la ligne ignorés.</summary>
internal static class Hex
{
    public static byte[] Bytes(string text) =>
        Convert.FromHexString(string.Concat(text.Where(c => !char.IsWhiteSpace(c))));

    public static uint[] WordsLittleEndian(string text)
    {
        byte[] bytes = Bytes(text);
        uint[] words = new uint[bytes.Length / 4];
        for (int i = 0; i < words.Length; i++)
            words[i] = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(i * 4, 4));
        return words;
    }
}
