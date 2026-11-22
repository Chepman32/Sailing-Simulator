#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingSharks.generated.h"

class ASailingYachtPawn;
class UStaticMeshComponent;

UCLASS()
class ASailingSharks : public AActor
{
    GENERATED_BODY()
public:
    ASailingSharks();
    void BeginPlay() override;
    void Tick(float Dt) override;

private:
    struct FSwimmer
    {
        FVector2D Position = FVector2D::ZeroVector, Direction = FVector2D(1,0);
        FVector2D Avoidance = FVector2D::ZeroVector;
        double Speed = 0, Phase = 0, NextLook = 0;
        int32 Turn = 1;
        bool bHasRoom = false, bPlaced = false;
    };
    bool OpenWater(FVector2D Cm, const ASailingYachtPawn& Yacht) const;
    UPROPERTY(EditAnywhere, Category="Wildlife") TObjectPtr<UStaticMesh> SharkMesh;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Body;
    FSwimmer S;
    FVector2D PreviousYacht = FVector2D::ZeroVector;
};
