#pragma once

#include "CoreMinimal.h"

namespace Sailing
{
struct FSprayPuff
{
    FVector OriginM = FVector::ZeroVector, VelocityMps = FVector::ZeroVector, WindMps = FVector::ZeroVector;
    float Born = -10, Life = 1, WidthM = 1, HeightM = 1, Strength = 0;
    float Seed = 0, Sheet = 0, StormThrow = 0, Suspension = 0;

    void LaunchFromBow(const FVector& WaterlineM, const FVector& Outboard, const FVector& Bow,
                       const FVector& BoatMps, const FVector& Wind, float Time, float Energy,
                       float Gale, float Fan, bool FineMist, FRandomStream& Random)
    {
        Sheet = FineMist ? .16f : Random.FRandRange(.58f,.94f);
        StormThrow = Gale*FMath::Lerp(.42f,1.f,Energy);
        Suspension = FineMist ? StormThrow : 0;
        Born = Time;
        OriginM = WaterlineM + Outboard*(.16+.34*Fan) - Bow*(.98*Fan);
        const float OutwardMps = (.95f+3.1f*Fan)*(1.f+.7f*Energy)*(1.f+.95f*StormThrow);
        VelocityMps = Outboard*OutwardMps + Bow*Random.FRandRange(-1.7f,1.f) + BoatMps*.4;
        VelocityMps.Z = (1.2f+3.9f*Energy)*(1.f+.36f*StormThrow)*Random.FRandRange(.70f,1.38f);
        WindMps = Wind*FMath::Lerp(.16f+.21f*(1.f-Sheet), FineMist ? .28f : .16f, StormThrow);
        Life = (.78f+Energy*.58f)*(1.f+.54f*StormThrow+1.10f*Suspension)*Random.FRandRange(.74f,1.15f);
        WidthM = (.32f+.49f*Energy)*(1.f+.45f*StormThrow)*Random.FRandRange(.74f,1.30f);
        HeightM = (.23f+.54f*Energy)*(1.f+.36f*StormThrow)*Random.FRandRange(.84f,1.27f);
        Strength = .28f+.72f*FMath::Sqrt(Energy);
        Seed = Random.FRand();
    }

    FVector PositionM(float Age) const
    {
        const float DragTime = (.32f+.52f*Sheet)*(1.f+.95f*StormThrow);
        const double Coast = DragTime*(1.-FMath::Exp(-Age/DragTime));
        FVector Offset = VelocityMps*Coast + WindMps*(Age-Coast);
        const float Fall = FMath::Lerp(.8f+3.9f*Sheet,4.905f,StormThrow);
        Offset.Z = Age*(VelocityMps.Z-Fall*Age);
        if (Suspension>0)
        {
            // Once the sheet atomizes the light drops lose their upward speed
            // to drag and settle slowly while the crosswind carries them away.
            const float Response = .81f+.30f*Seed;
            const float SettlingMps = 1.42f-.46f*Seed;
            const double MistZ = (VelocityMps.Z+SettlingMps)*Response*(1.-FMath::Exp(-Age/Response))-SettlingMps*Age;
            const float Detached = FMath::Min(1.f,1.7f*Suspension);
            Offset.Z = FMath::Lerp(Offset.Z,MistZ,Detached);
        }
        return OriginM+Offset;
    }

    float Opacity(float Phase) const
    {
        const float FadeFrom = .29f+.14f*StormThrow+.06f*Suspension;
        return Strength*FMath::SmoothStep(0.f,FMath::Lerp(.12f,.055f,StormThrow),Phase)
            *(1.f-FMath::SmoothStep(FadeFrom,1.f,Phase));
    }
};
}
