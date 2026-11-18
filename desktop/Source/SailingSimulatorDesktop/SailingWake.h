#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingWake.generated.h"

class UMaterialInterface;
class UProceduralMeshComponent;

UCLASS()
class ASailingWake : public AActor
{
    GENERATED_BODY()

public:
    ASailingWake();
    void BeginPlay() override;
    void Tick(float DeltaSeconds) override;

private:
    static constexpr int32 MaxRows = 120;
    static constexpr int32 Across = 7;
    static constexpr int32 Strips = 5;
    struct FSample
    {
        FVector2D Port;
        FVector2D Starboard;
        FVector2D Propeller;
        FVector2D BowPort;
        FVector2D BowStarboard;
        FVector2D Beam;
        float TimeS;
        float DistanceM;
        float Speed;
        float Wash;
    };

    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Foam;
    UPROPERTY(EditAnywhere, Category = "Sea") TObjectPtr<UMaterialInterface> FoamMaterial;
    TArray<FVector> Vertices;
    TArray<FVector2D> UVs;
    TArray<FLinearColor> Colors;
    TArray<FSample> Trail;
};
