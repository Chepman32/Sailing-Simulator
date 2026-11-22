#pragma once
#include "CoreMinimal.h"

namespace Sailing
{
// Both species sample the same world clock. Give the shark time to clear the
// surface before the dolphins approach, and let the pod leave before it returns.
inline double SharkDive(double Time)
{
    const double Phase = FMath::Fmod(Time, 100.);
    return FMath::SmoothStep(30., 35., Phase) * (1. - FMath::SmoothStep(95., 100., Phase));
}
inline double DolphinVisit(double Time)
{
    const double Phase = FMath::Fmod(Time, 100.);
    return FMath::SmoothStep(36., 43., Phase) * (1. - FMath::SmoothStep(86., 94., Phase));
}
}
