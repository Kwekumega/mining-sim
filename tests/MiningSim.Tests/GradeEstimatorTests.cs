using MiningSim.Core.Exploration;
using MiningSim.Core.Geology;

namespace MiningSim.Tests;

public class GradeEstimatorTests
{
    private static Assay At(double x, double y, double z, double grade) => new(x, y, z - 2.5, z + 2.5, grade);

    [Fact]
    public void NoSamplesInRangeMeansNoEstimate()
    {
        var estimator = new GradeEstimator(new EstimatorSettings { SearchRadius = 50 });

        var (grade, confidence, count) = estimator.EstimateAt(0, 0, 0, new[] { At(500, 500, 50, 3) });

        Assert.Equal(0, count);
        Assert.Equal(0, confidence);
        Assert.Equal(0, grade);
    }

    [Fact]
    public void EstimateAtSampleEqualsSample()
    {
        var estimator = new GradeEstimator();

        var (grade, confidence, _) = estimator.EstimateAt(10, 10, 50, new[] { At(10, 10, 50, 3.2), At(40, 10, 50, 0.1) });

        Assert.Equal(3.2, grade, precision: 9);
        Assert.Equal(1, confidence);
    }

    [Fact]
    public void CloserSampleWeighsMore()
    {
        var estimator = new GradeEstimator();
        var samples = new[] { At(0, 0, 50, 4), At(30, 0, 50, 0) };

        var (grade, _, _) = estimator.EstimateAt(10, 0, 50, samples);

        // Weights 1/10^2 and 1/20^2 give 4 * 0.8 = 3.2.
        Assert.Equal(3.2, grade, precision: 9);
    }

    [Fact]
    public void ConfidenceFallsAwayFromHoles()
    {
        var estimator = new GradeEstimator();
        var samples = new[] { At(0, 0, 50, 2) };

        var near = estimator.EstimateAt(5, 0, 50, samples).Confidence;
        var far = estimator.EstimateAt(40, 0, 50, samples).Confidence;

        Assert.True(near > far);
    }

    [Fact]
    public void DenserDrillingImprovesEstimate()
    {
        var model = DepositGenerator.Generate(seed: 21);
        var estimator = new GradeEstimator();

        double Error(double spacing)
        {
            var program = new DrillingProgram(model, budget: double.MaxValue, seed: 1);
            for (var x = spacing / 2; x < model.Width; x += spacing)
                for (var y = spacing / 2; y < model.Length; y += spacing)
                    program.Drill(x, y, model.Depth);

            var estimates = estimator.EstimateAll(model, program.Assays);
            return model.All().Average(b => Math.Abs(estimates[b.I, b.J, b.K].Grade - b.TrueGrade));
        }

        Assert.True(Error(spacing: 40) < Error(spacing: 100));
    }
}
