#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingWeather.generated.h"

class ADirectionalLight;
class AExponentialHeightFog;
class APostProcessVolume;
class ASkyLight;
class AStaticMeshActor;
class AVolumetricCloud;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class UPointLightComponent;
class UProceduralMeshComponent;

UCLASS()
class ASailingWeather : public AActor
{
    GENERATED_BODY()

public:
    ASailingWeather();
    void BeginPlay() override;
    void Tick(float DeltaSeconds) override;
    const TCHAR* ConditionName() const;

private:
    void UpdateRain(float Strength, float Time, const FVector& Eye, const FVector& Right);
    void StartStrike(float Time, const FVector& Eye, const FVector& Forward, const FVector& Right);
    void AddBolt(const TArray<FVector>& Path, const FVector& Eye, float WidthCm, float Strength);

    UPROPERTY(EditAnywhere, Category = "Weather") TObjectPtr<ADirectionalLight> Sun;
    UPROPERTY(EditAnywhere, Category = "Weather") TObjectPtr<ADirectionalLight> Moon;
    UPROPERTY(EditAnywhere, Category = "Weather") TObjectPtr<ASkyLight> Sky;
    UPROPERTY(EditAnywhere, Category = "Weather") TObjectPtr<AStaticMeshActor> SkyDome;
    UPROPERTY(EditAnywhere, Category = "Weather") TObjectPtr<AVolumetricCloud> Clouds;
    UPROPERTY(EditAnywhere, Category = "Weather") TObjectPtr<UMaterialInterface> CloudMaterial;
    UPROPERTY(EditAnywhere, Category = "Weather") TObjectPtr<AExponentialHeightFog> Fog;
    UPROPERTY(EditAnywhere, Category = "Weather") TObjectPtr<APostProcessVolume> Optics;
    UPROPERTY(EditAnywhere, Category = "Weather") TObjectPtr<UMaterialInterface> RainMaterial;
    UPROPERTY(EditAnywhere, Category = "Weather") TObjectPtr<UMaterialInterface> LightningMaterial;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Rain;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Bolt;
    UPROPERTY() TObjectPtr<UPointLightComponent> StrikeLight;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> CloudInstance;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> DistantSky;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> BoltInstance;

    FRandomStream Random{73};
    TArray<FVector> RainSeeds;
    TArray<FVector> RainVertices;
    TArray<FVector2D> RainUVs;
    TArray<FLinearColor> RainColors;
    TArray<FVector> BoltVertices;
    TArray<FVector2D> BoltUVs;
    TArray<FLinearColor> BoltColors;
    TArray<int32> BoltIndices;
    float Strengths[4] = {1.0f, 0.0f, 0.0f, 0.0f};
    int32 Condition = 0;
    float StrikeTime = -100.0f;
    float NextStrike = 6.0f;
    float PreviousFlash = 0.0f;
    bool bAtmosphereDirty = true;

#if !UE_BUILD_SHIPPING
    FString CapturePath;
    int32 Frames = 0;
    int32 CaptureFrame = 0;
#endif
};
