#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingSpray.h"
#include "SailingBreakers.h"
#include "SailingWeather.generated.h"

namespace Sailing { struct FSeaFrame; }
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
class UMaterialParameterCollection;
class UPointLightComponent;
class UProceduralMeshComponent;
class UStaticMeshComponent;

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
    void SetGraphicsQuality(int32 Level);
    int32 LightingChoice() const { return bAutoTime ? 3 : (Condition == 3 ? 2 : Condition); }
    static constexpr int32 AutoChoice = 7, CalmChoice = 8;
    int32 WeatherChoice() const { return bAutoWeather ? AutoChoice : (Climate == 7 ? CalmChoice : Climate); }
    const TCHAR* ClimateName() const;
    static const TCHAR* WeatherName(int32 Index);
    void WhaleSpray(FVector SourceM, FVector Course, Sailing::FSeaFrame Frame, bool bBlow, float Strength);
    void BreachSpray(const ASailingYachtPawn& Yacht, FVector SourceM, FVector Course, bool bLanding, float Force);
    void SkipperSplash(const ASailingYachtPawn& Yacht, FVector ContactCm, FVector VelocityCmS, float Force, bool bEntry);
    void RequestLightning() { bLightningRequested = true; }

private:
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Floatplane;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Airliner;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> StuntPlane;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> TowBanner;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> DisplaySmoke;
    FVector FlightOrigin=FVector::ZeroVector, FlightAxis=FVector::RightVector, FlightAcross=FVector::ForwardVector;
    int32 FlightNumber=INDEX_NONE;
    double FlightAltitude=56;
    TArray<FVector> BannerVertices, BannerNormals, SmokeVertices;
    TArray<FVector2D> BannerUVs, SmokeUVs;
    TArray<FLinearColor> SmokeColors;
    void PrepareAircraft();
    void UpdateBanner(double Age);
    void UpdateSmoke(double Age, const FVector& Eye);
    FVector FlightPosition(double Age, bool Stunt) const;
    void UpdateAircraft(float Time, const FVector& Eye);
    void UpdateRain(float Strength, float DeltaSeconds, const FVector& Eye, const FVector& Right, const FVector& Wind);
    void UpdateSpindrift(const ASailingYachtPawn& Yacht, float Air, const FVector& Eye, const FVector& Forward, const FVector& Right);
    void EmitShoreSpray(Sailing::FSeaFrame Frame, const FVector& EyeM, const FVector& Forward, const FVector& Right, const FVector& Wind);
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
    UPROPERTY(EditAnywhere, Category = "Weather") TObjectPtr<UMaterialParameterCollection> CoastalWeather;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Rain;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Spindrift;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> BreakerLips;
    Sailing::FBreakingSheets BreakingSheets;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Bolt;
    UPROPERTY() TObjectPtr<UPointLightComponent> StrikeLight;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> CloudInstance;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> DistantSky;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> BoltInstance;
    UPROPERTY() TObjectPtr<UMaterialInterface> UnderwaterMaterial;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> UnderwaterOptics;
    UPROPERTY(Transient) TObjectPtr<UExponentialHeightFogComponent> HeightFog;
    UPROPERTY(Transient) TObjectPtr<ASailingSea> SeaActor;
    FVector RainTravel = FVector::ZeroVector;
    float SurfaceWetness = 0.f;
    float SeaScale = 1.f;
    FLinearColor AirFogColor = FLinearColor::Black;
    FLinearColor AirSkyScatter = FLinearColor::White;
    float PreviousImmersion = 0;
    bool bAirUsesVolume = false;
    bool bUnderwaterOpticsActive = false;
    int32 GraphicsQuality = 2;

    FRandomStream Random{73};
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> RainInstance;
    static constexpr int32 CrestPuffCount = 96, BowPuffsPerSide = 48, WhalePuffCount = 16, BreachPuffCount = 48, SkipperPuffCount = 36;
    static constexpr int32 FirstShorePuff = CrestPuffCount + 2*BowPuffsPerSide + WhalePuffCount + BreachPuffCount;
    static constexpr int32 ShorePuffCount = 48;
    Sailing::FSprayPuff SprayPuffs[FirstShorePuff + ShorePuffCount + SkipperPuffCount];
    FRandomStream SprayRandom{4387};
    FRandomStream ShoreRandom{6831};
    float NextShoreSpray = 0.f;
    int32 NextShorePuff = 0;
    int32 NextCrestPuff = 0, NextBowPuff[2] = {};
    int32 NextSkipperPuff = 0;
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
