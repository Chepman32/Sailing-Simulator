#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingWhales.generated.h"

class ASailingYachtPawn;

UCLASS()
class ASailingWhales : public AActor
{
    GENERATED_BODY()
public:
    ASailingWhales();
    void BeginPlay() override;
    void Tick(float Dt) override;

private:
    struct FPass
    {
        FVector Start, Direction;
        double Age = -1, Next = 0;
        bool bContact = false;
    };
    bool FindPass(FPass& Pass, const ASailingYachtPawn& Yacht, bool bDistant) const;
    void Swim(FPass& Pass, UStaticMeshComponent& Body, ASailingYachtPawn& Yacht, float Dt, bool bDistant);
    UPROPERTY(EditAnywhere, Category="Wildlife") TObjectPtr<UStaticMesh> WhaleMesh;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Visitor;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Breacher;
    FPass Near, Far;
};
