#pragma once

#include "CoreMinimal.h"

class AHUD;
class ASailingYachtPawn;
class UCanvas;
class UWorld;

struct FSailingChart
{
    void Open(UWorld& World, const ASailingYachtPawn& Yacht);
    void Track(FVector YachtPosition);
    void Recenter(const ASailingYachtPawn& Yacht);
    void Pan(FVector2D Pixels);
    void Zoom(double Wheel, FVector2D Offset);
    void Draw(AHUD& HUD, UCanvas& Canvas, FVector2D Size, const ASailingYachtPawn& Yacht) const;
    int32 IslandCount() const { return Land.Num(); }
    FVector2D Center = FVector2D::ZeroVector;
    double MetersPerPixel = 1.65;
    bool bFollowing = true;

private:
    struct FIsland { FString Name; FVector2D Center; TArray<FVector2D> Coast; };
    struct FMark { FString Name; FVector2D Position; };
    bool bSurveyed = false;
    FString ChartTitle;
    TArray<FIsland> Land;
    TArray<FMark> Marks;
    TArray<FVector2D> Trail;
};
