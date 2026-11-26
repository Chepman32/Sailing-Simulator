#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingJetSkiMotion.h"
#include "SailingJetSki.generated.h"

class ASailingYachtPawn;
class UStaticMesh;
class UStaticMeshComponent;

UCLASS()
class ASailingJetSki : public AActor
{
    GENERATED_BODY()

public:
    ASailingJetSki();
    static void SpawnFleet(ASailingYachtPawn& Yacht, TArray<TObjectPtr<ASailingJetSki>>& Fleet);
    void Advance(const ASailingYachtPawn& Yacht, float Dt);
    void SetRidden(bool bValue);
    void SetInput(double Gas, double Turn) { Throttle = Gas; Steering = Turn; }
    bool CanDismount() const { return Motion.SpeedMps() < 2.3; }
    bool HasWaterClearance() const;
    const Sailing::FJetSkiMotion& Drive() const { return Motion; }
    FName BerthName() const { return Berth; }
    FVector Seat() const;

private:
    bool HasWaterClearance(FVector2D PositionM, FVector2D Bow) const;
    void UpdatePose(const ASailingYachtPawn& Yacht, float Dt);

    UPROPERTY() TObjectPtr<UStaticMeshComponent> Body;
    UPROPERTY() TArray<TObjectPtr<UStaticMesh>> AvailableModels;
    Sailing::FJetSkiMotion Motion;
    FVector2D PositionM = FVector2D::ZeroVector;
    FName Berth;
    double Accumulator = 0;
    double Throttle = 0, Steering = 0;
    double SeatHeightCm = 58.;
    bool bRidden = false;
};
