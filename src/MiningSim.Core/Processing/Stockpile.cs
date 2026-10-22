namespace MiningSim.Core.Processing;

/// <summary>A blended pile: tonnes and their average grade, reclaimed as a mix.</summary>
public sealed class Stockpile
{
    public double Tonnes { get; private set; }
    public double Grade { get; private set; }

    public void Add(double tonnes, double grade)
    {
        if (tonnes < 0) throw new ArgumentOutOfRangeException(nameof(tonnes));
        if (tonnes == 0) return;
        Grade = (Tonnes * Grade + tonnes * grade) / (Tonnes + tonnes);
        Tonnes += tonnes;
    }

    public (double Tonnes, double Grade) Take(double tonnes)
    {
        var taken = Math.Min(Math.Max(0, tonnes), Tonnes);
        var grade = Grade;
        Tonnes -= taken;
        if (Tonnes <= 1e-9)
        {
            Tonnes = 0;
            Grade = 0;
        }
        return (taken, taken > 0 ? grade : 0);
    }
}
