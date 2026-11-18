#include "SailingWeather.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/SkyLight.h"
#include "Engine/StaticMeshActor.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "ProceduralMeshComponent.h"
#include "SailingTrial.h"
#include "UnrealClient.h"

namespace
{
constexpr int32 RainCount = 1550;

struct FWeather
{
    const TCHAR* Name;
    float Altitude;
    float Azimuth;
    float SunLux;
    float MoonLux;
    float SkyIntensity;
    float Fog;
    float Scattering;
    float CloudCoverage;
    float CloudDensity;
    float SeaScale;
    float Rain;
};

constexpr FWeather Conditions[] = {
    { TEXT("Trade winds"), 30, 18, 83000, 0, 1.15f, 0.0020f, 1.7f, -0.48f, 0.0f, 1.0f, 0 },
    { TEXT("Golden hour"), 11, 3, 65000, 0, 1.04f, 0.0036f, 3.5f, -0.15f, 0.012f, 1.05f, 0 },
    { TEXT("Squall"), 19, -28, 3800, 0, 0.60f, 0.0135f, 2.4f, 0.13f, 0.030f, 2.43f, 1 },
    { TEXT("Moonlight"), -13, 25, 0, 4.5f, 0.74f, 0.0031f, 1.8f, -0.28f, 0.010f, 0.70f, 0 },
};

FVector WrapRain(const FVector& Position, const FVector& Eye)
{
    const FVector Extent(3600, 3600, 2500);
    const auto Wrap = [](double Value, double Center, double Radius)
    {
        const double Size = 2 * Radius;
        return Value - Size * FMath::FloorToDouble((Value - Center + Radius) / Size);
    };
    return FVector(Wrap(Position.X, Eye.X, Extent.X), Wrap(Position.Y, Eye.Y, Extent.Y),
        Wrap(Position.Z, Eye.Z + 900, Extent.Z));
}
}

ASailingWeather::ASailingWeather()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PostUpdateWork;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("WeatherRoot")));
    const auto Effect = [this](FName Name)
    {
        UProceduralMeshComponent* Mesh = CreateDefaultSubobject<UProceduralMeshComponent>(Name);
        Mesh->SetupAttachment(GetRootComponent());
        Mesh->SetAbsolute(true, true, true);
        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Mesh->SetCastShadow(false);
        Mesh->SetVisibility(false);
        return Mesh;
    };
    Rain = Effect(TEXT("Rain"));
    Bolt = Effect(TEXT("Lightning"));
    StrikeLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("LightningBounce"));
    StrikeLight->SetupAttachment(GetRootComponent());
    StrikeLight->SetIntensityUnits(ELightUnits::Lumens);
    StrikeLight->SetIntensity(0);
    StrikeLight->SetAttenuationRadius(120000);
    StrikeLight->SetSourceRadius(600);
    StrikeLight->SetCastShadows(false);
    StrikeLight->SetVolumetricScatteringIntensity(2.25f);
    StrikeLight->SetLightColor(FLinearColor(0.61f, 0.76f, 1.0f));
}

void ASailingWeather::BeginPlay()
{
    Super::BeginPlay();
    if (Clouds)
    {
        UVolumetricCloudComponent* Cloud = Clouds->FindComponentByClass<UVolumetricCloudComponent>();
        UMaterialInterface* Source = CloudMaterial ? CloudMaterial.Get() : Cloud->GetMaterial();
        if (Source)
        {
            CloudInstance = UMaterialInstanceDynamic::Create(Source, this);
            Cloud->SetMaterial(CloudInstance);
        }
    }
    if (SkyDome)
    {
        DistantSky = SkyDome->GetStaticMeshComponent()->CreateDynamicMaterialInstance(0);
    }
    BoltInstance = UMaterialInstanceDynamic::Create(LightningMaterial, this);
    Bolt->SetMaterial(0, BoltInstance);
    Rain->SetMaterial(0, RainMaterial);
    FString StartingWeather;
    if (FParse::Value(FCommandLine::Get(), TEXT("SailingWeather="), StartingWeather))
    {
        if (StartingWeather.Equals(TEXT("day"), ESearchCase::IgnoreCase)) Condition = 0;
        if (StartingWeather.Equals(TEXT("golden"), ESearchCase::IgnoreCase)) Condition = 1;
        if (StartingWeather.Equals(TEXT("squall"), ESearchCase::IgnoreCase)) Condition = 2;
        if (StartingWeather.Equals(TEXT("night"), ESearchCase::IgnoreCase)) Condition = 3;
        for (int32 I = 0; I < UE_ARRAY_COUNT(Conditions); ++I) Strengths[I] = I == Condition ? 1.0f : 0.0f;
    }
#if !UE_BUILD_SHIPPING
    FParse::Value(FCommandLine::Get(), TEXT("SailingCapture="), CapturePath);
#endif
    FRandomStream Drops(1249);
    TArray<int32> Indices;
    for (int32 I = 0; I < RainCount; ++I)
    {
        RainSeeds.Emplace(Drops.FRandRange(-3600, 3600), Drops.FRandRange(-3600, 3600), Drops.FRandRange(0, 5000));
        const int32 V = I * 4;
        RainUVs.Append({ {0, 1}, {1, 1}, {0, 0}, {1, 0} });
        Indices.Append({ V, V + 1, V + 2, V + 1, V + 3, V + 2 });
    }
    RainVertices.Init(FVector::ZeroVector, RainCount * 4);
    RainColors.Init(FLinearColor::Transparent, RainCount * 4);
    Rain->CreateMeshSection_LinearColor(0, RainVertices, Indices, {}, RainUVs, RainColors, {}, false);
}

const TCHAR* ASailingWeather::ConditionName() const
{
    return Conditions[Condition].Name;
}

void ASailingWeather::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    APlayerController* Player = GetWorld()->GetFirstPlayerController();
    if (!Player || !Player->PlayerCameraManager) return;

    const FKey Keys[] = { EKeys::One, EKeys::Two, EKeys::Three, EKeys::Four };
    for (int32 I = 0; I < UE_ARRAY_COUNT(Keys); ++I)
    {
        if (Player->WasInputKeyJustPressed(Keys[I]) && Condition != I)
        {
            Condition = I;
            bAtmosphereDirty = true;
        }
    }

    const float Time = GetWorld()->GetTimeSeconds();
    const FVector Eye = Player->PlayerCameraManager->GetCameraLocation();
    const FRotator View = Player->PlayerCameraManager->GetCameraRotation();
    const FVector Forward = View.Vector().GetSafeNormal2D();
    const FVector Right = FVector::CrossProduct(FVector::UpVector, Forward);
    const float BlendRate = 1.0f - FMath::Exp(-DeltaSeconds * 0.72f);
    if (bAtmosphereDirty)
    {
        for (int32 I = 0; I < UE_ARRAY_COUNT(Conditions); ++I)
        {
            const float Target = I == Condition ? 1.0f : 0.0f;
            Strengths[I] = FMath::Lerp(Strengths[I], Target, BlendRate);
            if (FMath::IsNearlyEqual(Strengths[I], Target, 0.0005f)) Strengths[I] = Target;
        }
    }
    const auto Value = [this](float FWeather::*Member)
    {
        float Total = 0;
        for (int32 I = 0; I < UE_ARRAY_COUNT(Conditions); ++I) Total += Strengths[I] * (Conditions[I].*Member);
        return Total;
    };

    const float RainStrength = Value(&FWeather::Rain);
    bool bForceStrike = Player->WasInputKeyJustPressed(EKeys::L);
#if !UE_BUILD_SHIPPING
    ++Frames;
    const bool bCapture = !CapturePath.IsEmpty() && Frames > 120 && Time > 7.0f;
    bForceStrike |= bCapture && CaptureFrame == 0 && Condition == 2;
#endif
    if (RainStrength > 0.46f && (Time >= NextStrike || (bForceStrike && Time - StrikeTime > 0.7f)))
    {
        StartStrike(Time, Eye, Forward, Right);
    }
    const float Age = Time - StrikeTime;
    const float FirstReturn = FMath::Exp(-Age * 24.0f);
    const float SecondReturn = Age > 0.15f ? 0.58f * FMath::Exp(-(Age - 0.15f) * 34.0f) : 0.0f;
    const float Flash = Age < 0.55f ? FirstReturn + SecondReturn : 0.0f;
    Bolt->SetVisibility(Flash > 0.015f);
    if (BoltInstance) BoltInstance->SetScalarParameterValue(TEXT("Flash"), Flash);
    StrikeLight->SetIntensity(Flash * 85000000.0f);
    if (CloudInstance && Flash != PreviousFlash)
    {
        CloudInstance->SetScalarParameterValue(TEXT("CloudFlash"), Flash);
    }

    if (bAtmosphereDirty)
    {
        if (Sun)
        {
            Sun->SetActorRotation(FRotator(-Value(&FWeather::Altitude), Value(&FWeather::Azimuth) + 180, 0));
            UDirectionalLightComponent* Light = Sun->FindComponentByClass<UDirectionalLightComponent>();
            Light->SetIntensity(Value(&FWeather::SunLux));
            Light->SetVolumetricScatteringIntensity(Value(&FWeather::Scattering));
        }
        if (Moon) Moon->GetLightComponent()->SetIntensity(Value(&FWeather::MoonLux));
        if (Fog) Fog->FindComponentByClass<UExponentialHeightFogComponent>()->SetFogDensity(Value(&FWeather::Fog));
        if (Optics)
        {
            Optics->Settings.AutoExposureBias = .13f + 0.6f * Strengths[3];
            Optics->Settings.bOverride_ColorSaturation = true;
            Optics->Settings.ColorSaturation = FVector4(1 - RainStrength * .35, 1 - RainStrength * .29, 1 - RainStrength * .19, 1);
            Optics->Settings.bOverride_ColorGain = true;
            Optics->Settings.ColorGain = FVector4(1 - RainStrength * .31, 1 - RainStrength * .20, 1 - RainStrength * .07, 1);
        }
        if (CloudInstance)
        {
            CloudInstance->SetScalarParameterValue(TEXT("Cloud_GlobalCoverage"), Value(&FWeather::CloudCoverage));
            CloudInstance->SetScalarParameterValue(TEXT("Cloud_GlobalDensity"), Value(&FWeather::CloudDensity));
        }
        if (DistantSky)
        {
            DistantSky->SetVectorParameterValue(TEXT("TimeOfDayWeights"), FLinearColor(Strengths[0], Strengths[1], Strengths[2]));
        }
    }
    if (Sky && (bAtmosphereDirty || Flash != PreviousFlash))
    {
        Sky->GetLightComponent()->SetIntensity(Value(&FWeather::SkyIntensity) * (1.0f + Flash * 2.45f));
    }
    PreviousFlash = Flash;
    bAtmosphereDirty = Strengths[Condition] < 1.0f;
    if (ASailingYachtPawn* Yacht = Cast<ASailingYachtPawn>(Player->GetPawn()))
    {
        Yacht->SetSeaScale(Value(&FWeather::SeaScale));
        Yacht->SetDeckLights(Strengths[3] + Strengths[2] * 0.15f);
    }
    UpdateRain(RainStrength, Time, Eye, Right);

#if !UE_BUILD_SHIPPING
    if (bCapture && CaptureFrame == 0)
    {
        if (const APawn* Yacht = Player->GetPawn())
        {
            UE_LOG(LogTemp, Display, TEXT("Coral Pass capture: %s at %.2f kn, position %s"), ConditionName(),
                Yacht->GetVelocity().Size2D() * 0.01 * Sailing::KnotsPerMps, *Yacht->GetActorLocation().ToCompactString());
        }
        FScreenshotRequest::RequestScreenshot(CapturePath, false, false);
        CaptureFrame = Frames;
    }
    if (CaptureFrame > 0 && Frames > CaptureFrame + 6)
    {
        FGenericPlatformMisc::RequestExit(false);
    }
#endif
}

void ASailingWeather::UpdateRain(float Strength, float Time, const FVector& Eye, const FVector& Right)
{
    Rain->SetVisibility(Strength > 0.02f);
    if (Strength <= 0.02f) return;
    const FVector Drift(435, 190, -1670);
    const FVector Side = Right * 1.3;
    for (int32 I = 0; I < RainCount; ++I)
    {
        const double Rate = 0.72 + 0.56 * ((I * 13) % 127) / 126.0;
        const FVector Drop = WrapRain(RainSeeds[I] + Drift * (Time * Rate), Eye);
        const FVector Tail = Drop - Drift * (0.028 * Rate);
        const int32 V = I * 4;
        RainVertices[V] = Drop - Side;
        RainVertices[V + 1] = Drop + Side;
        RainVertices[V + 2] = Tail - Side;
        RainVertices[V + 3] = Tail + Side;
        const double DistanceM = FVector::Distance(Drop, Eye) / 100.0;
        const float Alpha = Strength * FMath::SmoothStep(1.5, 7.0, DistanceM) * (1.0 - FMath::SmoothStep(23.0, 40.0, DistanceM))
            * FMath::SmoothStep(0.0, 150.0, Drop.Z);
        for (int32 Corner = 0; Corner < 4; ++Corner) RainColors[V + Corner].A = Alpha;
    }
    Rain->UpdateMeshSection_LinearColor(0, RainVertices, {}, RainUVs, RainColors, {}, false);
}

void ASailingWeather::StartStrike(float Time, const FVector& Eye, const FVector& Forward, const FVector& Right)
{
    StrikeTime = Time;
    NextStrike = Time + Random.FRandRange(11, 19);
    const float Distance = Random.FRandRange(48000, 78000);
    const float SideOfView = Random.FRand() > 0.42f ? -1.0f : 1.0f;
    FVector Base = Eye + Forward * Distance + Right * (SideOfView * Distance * Random.FRandRange(0.26f, 0.41f));
    Base.Z = 20;
    StrikeLight->SetWorldLocation(Base + FVector(0, 0, 5300));
    if (CloudInstance)
    {
        const FVector CloudPoint = (Base + Forward * 120000.0) * 0.00001;
        CloudInstance->SetVectorParameterValue(TEXT("StrikeOriginKm"), FLinearColor(CloudPoint.X, CloudPoint.Y, 1.2f));
    }
    TArray<FVector> Path;
    constexpr int32 Segments = 26;
    Path.Add(Base);
    for (int32 I = 1; I <= Segments; ++I)
    {
        const float T = static_cast<float>(I) / Segments;
        FVector Step = Forward * Random.FRandRange(-1800, 1900) + Right * Random.FRandRange(-2250, 2350);
        Step.Z = 3100 + T * 280 + Random.FRandRange(-960, 720);
        Path.Add(Path.Last() + Step);
    }
    BoltVertices.Reset();
    BoltUVs.Reset();
    BoltColors.Reset();
    BoltIndices.Reset();
    AddBolt(Path, Eye, 168, 1.0f);
    for (const int32 Root : { 8, 12, 17, 20, 24 })
    {
        TArray<FVector> Branch = { Path[Root] };
        const float Side = Random.FRand() > 0.5f ? 1.0f : -1.0f;
        const int32 Steps = Random.RandRange(4, 9);
        for (int32 I = 1; I <= Steps; ++I)
        {
            FVector Step = Right * (Side * Random.FRandRange(420, 1900)) + Forward * Random.FRandRange(-900, 1350);
            Step.Z = -Random.FRandRange(860, 1850);
            Branch.Add(Branch.Last() + Step);
        }
        AddBolt(Branch, Eye, 77, 0.65f);
    }
    Bolt->CreateMeshSection_LinearColor(0, BoltVertices, BoltIndices, {}, BoltUVs, BoltColors, {}, false);
}

void ASailingWeather::AddBolt(const TArray<FVector>& Path, const FVector& Eye, float WidthCm, float Strength)
{
    const int32 First = BoltVertices.Num();
    for (int32 I = 0; I < Path.Num(); ++I)
    {
        const FVector Along = Path[FMath::Min(I + 1, Path.Num() - 1)] - Path[FMath::Max(I - 1, 0)];
        const FVector Across = FVector::CrossProduct(Along, Path[I] - Eye).GetSafeNormal();
        const double T = static_cast<double>(I) / (Path.Num() - 1);
        const double Width = WidthCm * FMath::Lerp(1.0, 0.18, T);
        BoltVertices.Append({ Path[I] - Across * Width, Path[I] + Across * Width });
        BoltUVs.Append({ {0, T}, {1, T} });
        BoltColors.Append({ FLinearColor(1, 1, 1, Strength), FLinearColor(1, 1, 1, Strength) });
        if (I > 0)
        {
            const int32 V = First + (I - 1) * 2;
            BoltIndices.Append({ V, V + 1, V + 2, V + 1, V + 3, V + 2 });
        }
    }
}
