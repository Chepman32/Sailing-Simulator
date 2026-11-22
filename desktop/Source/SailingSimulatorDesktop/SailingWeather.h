#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingSpray.h"
#include "SailingWeather.generated.h"

class ADirectionalLight;
class AExponentialHeightFog;
class APostProcessVolume;
class ASkyLight;
class ASailingYachtPawn;
class ASailingSea;
class AStaticMeshActor;
class AVolumetricCloud;
class UExponentialHeightFogComponent;
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
    void SelectCondition(int32 Index);
    void SelectLighting(int32 Choice);
    void SelectWeather(int32 Choice);
    int32 LightingChoice() const { return bAutoTime ? 3 : (Condition == 3 ? 2 : Condition); }
    static constexpr int32 AutoChoice = 7, CalmChoice = 8;
    int32 WeatherChoice() const { return bAutoWeather ? AutoChoice : (Climate == 7 ? CalmChoice : Climate); }
    const TCHAR* ClimateName() const;
    static const TCHAR* WeatherName(int32 Index);
    void RequestLightning() { bLightningRequested = true; }

private:
    void UpdateRain(float Strength, float DeltaSeconds, const FVector& Eye, const FVector& Right, const FVector& Wind);
    void UpdateSpindrift(const ASailingYachtPawn& Yacht, float Air, const FVector& Eye, const FVector& Forward, const FVector& Right);
    Sailing::FSprayPuff* AcquireBowPuff(int32 Side, float Now, bool bStrike);
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
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Spindrift;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Bolt;
    UPROPERTY() TObjectPtr<UPointLightComponent> StrikeLight;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> CloudInstance;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> DistantSky;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> BoltInstance;
    UPROPERTY(Transient) TObjectPtr<UExponentialHeightFogComponent> HeightFog;
    UPROPERTY(Transient) TObjectPtr<ASailingSea> SeaActor;
    FVector RainTravel = FVector::ZeroVector;
    float SurfaceWetness = 0.f;
    float SeaScale = 1.f;
    FLinearColor AirFogColor = FLinearColor::Black;
    FLinearColor AirSkyScatter = FLinearColor::White;
    float PreviousImmersion = 0;
    bool bAirUsesVolume = false;

    FRandomStream Random{73};
    TArray<FVector> RainSeeds;
    TArray<FVector> RainVertices;
    TArray<FVector2D> RainUVs;
    TArray<FLinearColor> RainColors;
    static constexpr int32 CrestPuffCount = 96, BowPuffsPerSide = 48;
    Sailing::FSprayPuff SprayPuffs[CrestPuffCount + 2*BowPuffsPerSide];
    FRandomStream SprayRandom{4387};
    int32 NextCrestPuff = 0, NextBowPuff[2] = {};
    float LastThrown[2] = {-10.f,-10.f};
    float NextSheet[2] = {};
    float NextSprayTime = 0;
    TArray<FVector> SprayVertices;
    TArray<FVector2D> SprayUVs;
    TArray<FLinearColor> SprayColors;
    TArray<FVector> BoltVertices;
    TArray<FVector2D> BoltUVs;
    TArray<FLinearColor> BoltColors;
    TArray<int32> BoltIndices;
    float Strengths[4] = {1.0f, 0.0f, 0.0f, 0.0f};
    int32 Condition = 0;
    int32 Climate = 0, AutoStep = 0;
    float ClimateMix[8] = {1};
    bool bAutoTime = false, bAutoWeather = false;
    float NextLighting = 0, NextWeather = 0;
    float StrikeTime = -100.0f;
    float NextStrike = 6.0f;
    float PreviousFlash = 0.0f;
    bool bAtmosphereDirty = true;
    bool bLightningRequested = false;

    FString CapturePath;
    int32 Frames = 0;
    int32 CaptureFrame = 0;
};
