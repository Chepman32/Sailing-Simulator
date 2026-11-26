#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingSharkMotion.h"
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
        Sailing::FSharkMotion Motion;
        FVector2D Avoidance = FVector2D::ZeroVector;
        FVector2D FollowVelocity = FVector2D::ZeroVector;
        double NextLook = 0, HoldCourseUntil = 0, FilteredSurfaceCm = 0;
        int32 Turn = 1;
        bool bHasRoom = false, bForwardClear = false, bPlaced = false;
    };
    bool OpenWater(FVector2D Cm, const ASailingYachtPawn& Yacht) const;
    UPROPERTY(EditAnywhere, Category="Wildlife") TObjectPtr<UStaticMesh> SharkMesh;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Body;
    FSwimmer S;
    FVector2D PreviousYacht = FVector2D::ZeroVector;
};
