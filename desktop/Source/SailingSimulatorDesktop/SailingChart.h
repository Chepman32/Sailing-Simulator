#pragma once

#include "CoreMinimal.h"

class AHUD;
class ASailingYachtPawn;
class UCanvas;
class UFont;
class UWorld;

struct FSailingChart
{
    void Open(UWorld& World, const ASailingYachtPawn& Yacht);
    void Track(FVector YachtPosition);
    void Recenter(const ASailingYachtPawn& Yacht);
    void Fit(FVector2D PlotSize, const ASailingYachtPawn& Yacht);
    void Pan(FVector2D Pixels);
    void Zoom(double Wheel, FVector2D Offset);
    void SetWaypoint(FVector2D PositionM, const ASailingYachtPawn& Yacht);
    void ClearWaypoint() { Waypoint.Reset(); }
    bool HasWaypoint() const { return Waypoint.IsSet(); }
    const FString& WaypointLabel() const { return WaypointName; }
    FString WaypointReadout(const ASailingYachtPawn& Yacht) const;
    FVector2D WorldAt(FVector2D Cursor, const FBox2D& Area) const;
    static FBox2D Plot(FVector2D Size);
    void Draw(AHUD& HUD, UCanvas& Canvas, UFont& Font, FVector2D Size, const ASailingYachtPawn& Yacht) const;
    int32 IslandCount() const { return Land.Num(); }
    FVector2D Center = FVector2D::ZeroVector;
    double MetersPerPixel = 1.65;
    bool bFollowing = true;

private:
    struct FIsland { FString Name; FVector2D Center; TArray<FVector2D> Coast, Shoal; };
    struct FMark { FString Name; FVector2D Position; };
    bool bSurveyed = false;
    TOptional<FVector2D> Waypoint;
    FString WaypointName;
    TArray<FIsland> Land;
    TArray<FMark> Marks;
    TArray<FVector2D> Trail;
};
