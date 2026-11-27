#pragma once

#include "Components/ActorComponent.h"
#include "SailingCrabs.generated.h"

class ASailingYachtPawn;
class UInstancedStaticMeshComponent;

UCLASS()
class USailingCrabs : public UActorComponent
{
    GENERATED_BODY()
public:
    USailingCrabs();
    void Populate();
    void Advance(const ASailingYachtPawn& Yacht, float Dt);
    bool Nearest(bool Underwater, FVector From, FVector& Found) const;
private:
    static constexpr int32 Side=7;
    struct FCrab
    {
        FIntPoint Cell{MAX_int32,MAX_int32};
        FVector Home=FVector::ZeroVector, Position=FVector::ZeroVector, Normal=FVector::UpVector;
        float Heading=0, Width=0, Speed=0, Phase=0, Decision=0, Gait=0;
        int32 Species=INDEX_NONE;
        bool bMoving=false, bVisible=false;
    };
    bool Ground(FVector2D XY, FVector& Point, FVector& Normal) const;
    void Place(FCrab& Crab,FIntPoint Cell);
    UPROPERTY() TObjectPtr<UStaticMesh> Models[2];
    UPROPERTY(Transient) TObjectPtr<UInstancedStaticMeshComponent> Meshes[2];
    FCrab Animals[Side*Side];
    FVector PreviousEye=FVector::ZeroVector;
    float Elapsed=0, ScanIn=0;
};
