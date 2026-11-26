#pragma once

#include "CoreMinimal.h"
#include "SailingPhysics.h"

class UProceduralMeshComponent;

namespace Sailing
{
// The aerated lip can overturn above the single-valued buoyancy surface.
class FBreakingSheets
{
public:
    void Initialize(UProceduralMeshComponent& Mesh);
    void BreakAt(const FShoreLip& Lip, FSeaFrame Frame, bool Ultra, float Seed);
    void Update(UProceduralMeshComponent& Mesh, FSeaFrame Frame, int32 Quality, float Air);

private:
    struct FSheet
    {
        FVector2D CenterM = FVector2D::ZeroVector;
        float Born = -10, Life = 0, HalfSpanM = 0, Seed = 0;
        FVector2D Shoreward=FVector2D::ZeroVector;
        float SpeedMps=0, Air=0, LastUpdate=0;
    };
    static constexpr int32 Count=6, Columns=13, Rows=8;
    FSheet Sheets[Count];
    TArray<FVector> Positions, Normals;
    TArray<FVector2D> UVs;
    TArray<FLinearColor> Colors;
};
}
