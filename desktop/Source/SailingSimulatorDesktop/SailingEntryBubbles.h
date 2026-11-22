#pragma once

#include "CoreMinimal.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "SailingEntryBubbles.generated.h"

class ASailingYachtPawn;

UCLASS()
class USailingEntryBubbles : public UInstancedStaticMeshComponent
{
    GENERATED_BODY()
public:
    USailingEntryBubbles();
    void Splash(const ASailingYachtPawn& Yacht, FVector Eye, FVector Forward, float ImpactCmS);
    void TickComponent(float Dt, ELevelTick TickType, FActorComponentTickFunction* Tick) override;
private:
    struct FBubble
    {
        FVector Position, Velocity;
        float Radius, Age, Life, Phase;
    };
    static constexpr int32 Capacity = 88;
    TArray<FBubble> Bubbles;
    TArray<FTransform> Transforms;
    FRandomStream Random{192113};
    void DrawBubbles();
};
