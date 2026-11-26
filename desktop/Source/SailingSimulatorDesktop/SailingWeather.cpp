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
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialParameterCollectionInstance.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "ProceduralMeshComponent.h"
#include "SailingExplorer.h"
#include "SailingTrial.h"
#include "UnrealClient.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
constexpr int32 RainCount = 4096;

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
    { TEXT("Trade winds"), 36, -23, 86000, 0, 1.08f, 0.0028f, 1.0f, -0.48f, 0.0f, 1.0f, 0 },
    { TEXT("Golden hour"), 11, 3, 65000, 0, 1.04f, 0.0027f, 2.75f, -0.15f, 0.012f, 1.05f, 0 },
    { TEXT("Squall"), 19, -28, 3800, 0, 0.60f, 0.0135f, 2.4f, 0.13f, 0.030f, 2.43f, 1 },
    { TEXT("Moonlight"), -13, 25, 0, .65f, 0.38f, 0.0031f, 1.8f, -0.28f, 0.010f, 0.70f, 0 },
};

struct FClimate
{
    const TCHAR* Name;
    float Sun, Sky, Fog, Cloud, Coverage, Waves, Rain, StormSky;
};
// For a horizontal ray at sea level UE's height integral reduces to ln(2),
// then exp2 attenuates the contrast. 10 * ln(20) / ln(2)^2 gives the
// nominal 5% contrast range in metres before the renderer's opacity cap.
constexpr float RainExtinction(float VisibilityM)
{
    return 62.351f / VisibilityM;
}
constexpr FClimate Climates[] = {
    {TEXT("Clear"),    1.f,   1.f,  0,      0,     0,   1.f,  0,    0},
    {TEXT("Cloudy"),   .83f,  .98f, .0007f, .009f, .25f,1.14f,0,    .08f},
    {TEXT("Overcast"), .39f,  .86f, .0030f, .017f, .43f,1.38f,0,    .36f},
    {TEXT("Rain"),     .21f,  .79f, RainExtinction(4200.f), .022f, .51f,1.61f,.42f, .55f},
    {TEXT("Downpour"), .083f, .66f, RainExtinction(1400.f), .027f, .57f,1.94f,.83f, .78f},
    {TEXT("Storm"),    3800.f/86000.f,.60f/1.08f,RainExtinction(780.f),.030f,.61f,Sailing::StormSeaScale,1.f,1.f},
    {TEXT("Hurricane"),.028f, .49f, RainExtinction(330.f), .037f, .76f,Sailing::HurricaneSeaScale,1.f,1.f},
    {TEXT("Calm"),     1.f,   1.f,  0,      0,     0,   .16f, 0,    0},
};
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
        Mesh->SetVisibleInRayTracing(false);
        Mesh->SetVisibility(false);
        return Mesh;
    };
    auto Aircraft = [this](FName Name, UStaticMesh* Model) {
        auto* Mesh=CreateDefaultSubobject<UStaticMeshComponent>(Name);
        Mesh->SetupAttachment(GetRootComponent());
        Mesh->SetStaticMesh(Model);
        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Mesh->SetCanEverAffectNavigation(false);
        return Mesh;
    };
    static ConstructorHelpers::FObjectFinder<UStaticMesh> BushModel(TEXT("/Game/Coastal/Meshes/SM_Floatplane.SM_Floatplane"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> JetModel(TEXT("/Game/Coastal/Meshes/SM_Airliner.SM_Airliner"));
    Floatplane=Aircraft(TEXT("Sightseeing floatplane"),BushModel.Object);
    Airliner=Aircraft(TEXT("Cruising airliner"),JetModel.Object);
    Airliner->SetCastShadow(false);
    Rain = Effect(TEXT("Rain"));
    Spindrift = Effect(TEXT("CrestSpray"));
    static ConstructorHelpers::FObjectFinder<UMaterialInterface> SprayMaterial(TEXT("/Game/Coastal/Materials/M_StormSpindrift.M_StormSpindrift"));
    Spindrift->SetMaterial(0,SprayMaterial.Object);
    BreakerLips = Effect(TEXT("BreakerLips"));
    static ConstructorHelpers::FObjectFinder<UMaterialInterface> LipMaterial(TEXT("/Game/Coastal/Materials/M_BreakerLip.M_BreakerLip"));
    BreakerLips->SetMaterial(0,LipMaterial.Object);
    static ConstructorHelpers::FObjectFinderOptional<UMaterialInterface> WaterVolume(
        TEXT("/Game/Coastal/Materials/M_UnderwaterOptics.M_UnderwaterOptics"), LOAD_Quiet | LOAD_NoWarn);
    UnderwaterMaterial = WaterVolume.Get();
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
    SeaActor = Cast<ASailingSea>(UGameplayStatics::GetActorOfClass(this, ASailingSea::StaticClass()));
    if (Fog)
    {
        HeightFog = Fog->FindComponentByClass<UExponentialHeightFogComponent>();
        if (HeightFog)
        {
            AirFogColor = HeightFog->FogInscatteringLuminance;
            AirSkyScatter = HeightFog->SkyAtmosphereAmbientContributionColorScale;
            bAirUsesVolume = HeightFog->bEnableVolumetricFog;
        }
    }
    if (Clouds)
    {
        UVolumetricCloudComponent* Cloud = Clouds->FindComponentByClass<UVolumetricCloudComponent>();
        // The broken undercast has longer unobstructed rays than a solid cloud slab.
        // Budget the direct view and its lower-frequency reflection separately.
        Cloud->SetViewSampleCountScale(.77f);
        Cloud->SetShadowViewSampleCountScale(.67f);
        Cloud->SetReflectionViewSampleCountScale(.42f);
        Cloud->SetShadowReflectionViewSampleCountScale(.38f);
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
    RainInstance = Rain->CreateDynamicMaterialInstance(0,RainMaterial);
    if (Optics && UnderwaterMaterial) UnderwaterOptics = UMaterialInstanceDynamic::Create(UnderwaterMaterial, this);
    FString StartingWeather;
    if (FParse::Value(FCommandLine::Get(), TEXT("SailingWeather="), StartingWeather))
    {
        if (StartingWeather.Equals(TEXT("day"), ESearchCase::IgnoreCase)) SelectCondition(0);
        if (StartingWeather.Equals(TEXT("golden"), ESearchCase::IgnoreCase)) SelectCondition(1);
        if (StartingWeather.Equals(TEXT("squall"), ESearchCase::IgnoreCase)) SelectCondition(2);
        if (StartingWeather.Equals(TEXT("night"), ESearchCase::IgnoreCase)) SelectCondition(3);
        for (int32 I=0; I<UE_ARRAY_COUNT(Climates); ++I)
            if (StartingWeather.Equals(Climates[I].Name, ESearchCase::IgnoreCase))
                SelectWeather(I == 7 ? CalmChoice : I);
        for (int32 I = 0; I < UE_ARRAY_COUNT(Conditions); ++I) Strengths[I] = I == Condition ? 1.0f : 0.0f;
        for (int32 I = 0; I < UE_ARRAY_COUNT(Climates); ++I) ClimateMix[I] = I == Climate ? 1.f : 0.f;
        SurfaceWetness = Climates[Climate].Rain;
        SeaScale = Climate==0 ? Conditions[Condition].SeaScale : Climates[Climate].Waves;
    }
    FParse::Value(FCommandLine::Get(), TEXT("SailingCapture="), CapturePath);
    FRandomStream Drops(1249);
    TArray<int32> Indices;
    FProcMeshSection DropsSection;
    const FVector2D Corners[] = {{0,1},{1,1},{0,0},{1,0}};
    for (int32 I = 0; I < RainCount; ++I)
    {
        const FVector Seed(Drops.FRandRange(-3600,3600), Drops.FRandRange(-3600,3600), Drops.FRandRange(0,5000));
        const FVector2D Flight(.72+.56*((I*13)%127)/126., I%3 == 0 ? 1250. : 3600.);
        for (const FVector2D Corner : Corners)
        {
            FProcMeshVertex& Vertex = DropsSection.ProcVertexBuffer.AddDefaulted_GetRef();
            Vertex.Position = Seed;
            Vertex.UV0 = Corner;
            Vertex.UV1 = Flight;
        }
        const uint32 V = I*4;
        DropsSection.ProcIndexBuffer.Append({V,V+1,V+2,V+1,V+3,V+2});
    }
    // The shader wraps drops about the eye and trails their tails upwind.
    DropsSection.SectionLocalBox = FBox(FVector(-3800),FVector(3800));
    Rain->SetProcMeshSection(0,DropsSection);

    constexpr int32 PuffCount = UE_ARRAY_COUNT(SprayPuffs);
    SprayVertices.Init(FVector::ZeroVector,4*PuffCount);
    SprayColors.Init(FLinearColor::Transparent,4*PuffCount);
    for (int32 I = 0; I < PuffCount; ++I)
    {
        SprayUVs.Append(Corners,4);
        const int32 V = I*4;
        Indices.Append({V,V+1,V+2,V+1,V+3,V+2});
    }
    Spindrift->CreateMeshSection_LinearColor(0,SprayVertices,Indices,{},SprayUVs,SprayColors,{},false);
    BreakingSheets.Initialize(*BreakerLips);
}

const TCHAR* ASailingWeather::ConditionName() const
{
    if (Climate==0) return Conditions[Condition].Name;
    return Climate==5 && Condition==0 ? TEXT("Squall") : ClimateName();
}

const TCHAR* ASailingWeather::WeatherName(int32 Index)
{
    return Index == AutoChoice ? TEXT("Auto") : Climates[Index == CalmChoice ? 7 : FMath::Clamp(Index,0,6)].Name;
}
const TCHAR* ASailingWeather::ClimateName() const { return Climates[Climate].Name; }

void ASailingWeather::SelectCondition(int32 Index)
{
    if (Index<0 || Index>=UE_ARRAY_COUNT(Conditions)) return;
    SelectLighting(Index==3 ? 2 : (Index==1 ? 1 : 0));
    SelectWeather(Index==2 ? 5 : 0);
}

void ASailingWeather::SelectLighting(int32 Choice)
{
    if (Choice<0 || Choice>3) return;
    bAutoTime = Choice==3;
    if (!bAutoTime) Condition = Choice==2 ? 3 : Choice;
    NextLighting = GetWorld()->GetTimeSeconds()+90;
    bAtmosphereDirty = true;
}

void ASailingWeather::SelectWeather(int32 Choice)
{
    if (Choice<0 || Choice>CalmChoice) return;
    bAutoWeather = Choice==AutoChoice;
    if (!bAutoWeather) Climate=Choice==CalmChoice ? 7 : Choice;
    NextWeather = GetWorld()->GetTimeSeconds()+65;
    bAtmosphereDirty = true;
}

void ASailingWeather::UpdateAircraft(float Time, float Dt, const FVector& Eye)
{
    // The floatplane flies a continuous banked circuit over the inshore route.
    // When the player sails farther afield, move the route gradually with them.
    const FVector2D Offset=FVector2D(Eye)*.01-FlightCenter;
    if (Offset.SizeSquared()>FMath::Square(460.))
        FlightCenter+=Offset.GetSafeNormal()*FMath::Min(Offset.Size()-460.,double(Dt)*14.);
    const double Phase=Time*.084-1.70, S=FMath::Sin(Phase), C=FMath::Cos(Phase);
    const FVector Position(FlightCenter.X+350*C,FlightCenter.Y+175*S,49.+14.*C);
    const FVector Tangent(-350*S,175*C,-14*S);
    FRotator Pose=Tangent.Rotation();
    const double Speed=Tangent.Size2D()*.084;
    const double Curvature=350.*175./FMath::Pow(Tangent.Size2D(),3.);
    Pose.Roll=-FMath::RadiansToDegrees(FMath::Atan(Speed*Speed*Curvature/9.81));
    Floatplane->SetWorldLocationAndRotation(Position*100.,Pose);
    const FVector Course(.932327,.361615,0.);
    const double Along=FMath::Fmod(Time*172.+18400.,38000.)-19000.;
    const FVector Jet=FVector(80.,-1250.,2700.)+Course*Along;
    Airliner->SetWorldLocationAndRotation(Jet*100.,Course.Rotation());
    if (DistantSky) DistantSky->SetVectorParameterValue(TEXT("JetTrack"),FLinearColor(Jet.X,Jet.Y,Jet.Z));
}

void ASailingWeather::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    APlayerController* Player = GetWorld()->GetFirstPlayerController();
    if (!Player || !Player->PlayerCameraManager) return;

    const float Time = GetWorld()->GetTimeSeconds();
    if (bAutoTime && Time>=NextLighting)
    {
        Condition = Condition==0 ? 1 : (Condition==1 ? 3 : 0);
        NextLighting=Time+90;
        bAtmosphereDirty=true;
    }
    if (bAutoWeather && Time>=NextWeather)
    {
        constexpr int32 Sequence[] = {1,2,3,4,5,2,1,0};
        Climate=Sequence[AutoStep++%UE_ARRAY_COUNT(Sequence)];
        NextWeather=Time+65;
        bAtmosphereDirty=true;
    }
    const FVector Eye = Player->PlayerCameraManager->GetCameraLocation();
    UpdateAircraft(Time,DeltaSeconds,Eye);
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
        for (int32 I = 0; I < UE_ARRAY_COUNT(Climates); ++I)
        {
            const float Target = I==Climate ? 1.f : 0.f;
            ClimateMix[I]=FMath::Lerp(ClimateMix[I],Target,BlendRate);
            if (FMath::IsNearlyEqual(ClimateMix[I],Target,.0005f)) ClimateMix[I]=Target;
        }
    }
    const auto Value = [this](float FWeather::*Member)
    {
        float Total = 0;
        for (int32 I = 0; I < UE_ARRAY_COUNT(Conditions); ++I) Total += Strengths[I] * (Conditions[I].*Member);
        return Total;
    };

    const auto ClimateValue = [this](float FClimate::*Member)
    {
        float Sum=0;
        for (int32 I=0; I<UE_ARRAY_COUNT(Climates); ++I) Sum+=ClimateMix[I]*(Climates[I].*Member);
        return Sum;
    };
    const float RainStrength = ClimateValue(&FClimate::Rain);
    const float StormSky = ClimateValue(&FClimate::StormSky);
    const float SunLux = Value(&FWeather::SunLux)*ClimateValue(&FClimate::Sun);
    const float MoonLux = Value(&FWeather::MoonLux)*ClimateValue(&FClimate::Sky);
    const bool bDetailed = GraphicsQuality >= 2;
    const bool bUltra = GraphicsQuality == 3;
    bool bForceStrike = bLightningRequested;
    bLightningRequested = false;
    const bool bCapture = !CapturePath.IsEmpty() && ++Frames > 120 && Time > 7.0f;
    const bool Thunderstorm = Climate==5 || Climate==6;
    bForceStrike |= bCapture && CaptureFrame == 0 && Thunderstorm;
    if (Thunderstorm && RainStrength > 0.46f && (Time >= NextStrike || (bForceStrike && Time - StrikeTime > 0.7f)))
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
            Sun->SetActorRotation(FRotator(-Value(&FWeather::Altitude)+17*StormSky*Strengths[0], Value(&FWeather::Azimuth)+180-5*StormSky, 0));
            UDirectionalLightComponent* Light = Sun->FindComponentByClass<UDirectionalLightComponent>();
            Light->SetIntensity(SunLux);
            // Dense cloud spreads the remaining direct light over a broad patch of sky.
            const float Obscured = FMath::SmoothStep(.10f,.81f,StormSky);
            Light->SetLightColor(FMath::Lerp(FLinearColor::White, FLinearColor(.72f,.83f,1.f), Obscured));
            Light->SetLightSourceAngle(.53f + 1.5f*Obscured);
            Light->SetLightSourceSoftAngle(3.f*Obscured);
            // The real-time sky capture supplies the broad reflection. Only the
            // visible fraction of the sun should still form a directional glint.
            // Keep the sun's compact core distinct from the bright sky around
            // it, which already reaches the water through the reflection pass.
            Light->SetSpecularScale(FMath::Lerp(bUltra ? .54f : bDetailed ? .38f : .24f,.014f,Obscured));
            const float ShaftStrength = bUltra ? 1.82f : bDetailed ? 1.48f : 1.f;
            Light->SetVolumetricScatteringIntensity(ShaftStrength*Value(&FWeather::Scattering)*(1.f-.85f*Obscured));
            Light->SetEnableLightShaftOcclusion(bDetailed && SunLux > 500.f);
            Light->SetEnableLightShaftBloom(bDetailed && SunLux > 500.f);
        }
        if (Moon) Moon->GetLightComponent()->SetIntensity(MoonLux);
        if (Optics)
        {
            const float Noon = Strengths[0] * FMath::SmoothStep(32000.f, 82500.f, SunLux);
            Optics->Settings.AutoExposureBias = .13f - 1.35f*Strengths[3] - .16f*Noon - .24f*Strengths[1] - .37f*StormSky;
            Optics->Settings.bOverride_ColorGainHighlights = true;
            // The pale foam and reflected overcast take their colour from the
            // cool skylight once the warm solar disc disappears behind rain.
            Optics->Settings.ColorGainHighlights = FVector4(1.f-.025f*StormSky, 1.f+.025f*StormSky,
                1.f+.14f*StormSky, 1.f-.19f*Noon);
            Optics->Settings.bOverride_BloomIntensity = true;
            Optics->Settings.BloomIntensity = (bUltra ? .42f : bDetailed ? .28f : .13f) - .10f * Noon;
            Optics->Settings.bOverride_ColorSaturation = true;
            Optics->Settings.ColorSaturation = FVector4(1 - RainStrength * .35, 1 - RainStrength * .29, 1 - RainStrength * .19, 1);
            Optics->Settings.bOverride_ColorGain = true;
            Optics->Settings.ColorGain = FVector4(1 - RainStrength * .31, 1 - RainStrength * .20, 1 - RainStrength * .07, 1);
        }
        if (CloudInstance)
        {
            const float Density = Value(&FWeather::CloudDensity)+ClimateValue(&FClimate::Cloud);
            CloudInstance->SetScalarParameterValue(TEXT("Cloud_GlobalCoverage"), Value(&FWeather::CloudCoverage)+ClimateValue(&FClimate::Coverage));
            CloudInstance->SetScalarParameterValue(TEXT("Cloud_GlobalDensity"), Density);
        }
        if (DistantSky)
        {
            DistantSky->SetVectorParameterValue(TEXT("TimeOfDayWeights"), FLinearColor(Strengths[0]*(1-StormSky),
                Strengths[1]*(1-StormSky), (Strengths[0]+Strengths[1])*StormSky));
        }
    }
    if (Sky && (bAtmosphereDirty || Flash != PreviousFlash))
    {
        const float SkyFill = 1.f + (bUltra ? .15f : bDetailed ? .09f : 0.f)*Strengths[1];
        Sky->GetLightComponent()->SetIntensity(Value(&FWeather::SkyIntensity)*ClimateValue(&FClimate::Sky)*(SkyFill + Flash * 2.45f));
    }
    PreviousFlash = Flash;
    ASailingYachtPawn* Yacht = Cast<ASailingYachtPawn>(Player->GetPawn());
    // Dive optics follow the active camera, including the fixed water replays.
    const float Depth = !Yacht ? 0.f : Player->GetViewTarget() == Yacht ? Yacht->Explorer().DepthM()
        : Eye.Z < 350. ? Yacht->SurfaceHeightM(FVector2D(Eye)*.01) - Eye.Z*.01 : 0.f;
    const float Immersion = FMath::RoundToFloat(12 * FMath::SmoothStep(.04f, .62f, Depth)) / 12;
    if (UnderwaterOptics)
    {
        if (Depth > .025f)
        {
            const float Light = .032f*SunLux + 2.5f*MoonLux + 1.5f;
            UnderwaterOptics->SetScalarParameterValue(TEXT("EyeDepth"),Depth);
            UnderwaterOptics->SetScalarParameterValue(TEXT("Turbidity"),StormSky);
            UnderwaterOptics->SetScalarParameterValue(TEXT("WaterLight"),Light);
            UnderwaterOptics->SetScalarParameterValue(TEXT("VolumeDetail"),bUltra ? 2.f : bDetailed ? 1.f : 0.f);
        }
        if (bUnderwaterOpticsActive != (Depth > .025f))
        {
            bUnderwaterOpticsActive = Depth > .025f;
            Optics->AddOrUpdateBlendable(UnderwaterOptics, bUnderwaterOpticsActive ? 1.f : 0.f);
        }
    }
    if (bAtmosphereDirty || Immersion != PreviousImmersion)
    {
        if (HeightFog)
        {
            const float Light = .034f*SunLux + .075f*MoonLux + .015f;
            const FLinearColor WaterScatter = FLinearColor(.013f, .112f, .159f) * Light;
            HeightFog->SetFogDensity(FMath::Lerp(Value(&FWeather::Fog)+ClimateValue(&FClimate::Fog),
                UnderwaterOptics ? 0.f : .64f, Immersion));
            // Rain obscures distant land while light still reaches the nearby
            // windward faces. Keep the wet boundary layer low over the sea.
            const float RainBank = StormSky*(1-Immersion);
            HeightFog->SetFogHeightFalloff(.22f+.31f*RainBank);
            // A shallow layer of humid air catches the shadows of the palms at
            // dawn and dusk. Spend the fog slices on that coastal layer.
            FExponentialHeightFogData SeaMist;
            SeaMist.FogDensity = (bUltra ? .009f : bDetailed ? .0065f : 0.f)
                * (.32f*Strengths[0] + .78f*Strengths[1]) * (1.f-.85f*StormSky) * (1.f-Immersion);
            SeaMist.FogHeightFalloff = .68f;
            SeaMist.FogHeightOffset = 80.f;
            HeightFog->SetSecondFogData(SeaMist);
            HeightFog->SetVolumetricFogDistance(FMath::Lerp(bUltra ? 105000.f : 80000.f, 160000.f, StormSky));
            HeightFog->SetVolumetricFogScatteringDistribution(FMath::Lerp(.49f+.14f*Strengths[1], .24f, RainBank));
            HeightFog->SetVolumetricFogExtinctionScale(1.18f-.54f*RainBank);
            const FLinearColor RainLight = FLinearColor(.013f,.016f,.020f)*(SunLux + MoonLux)*RainBank;
            HeightFog->SetFogInscatteringColor(FMath::Lerp(AirFogColor+RainLight,
                UnderwaterOptics ? FLinearColor::Black : WaterScatter, Immersion));
            HeightFog->SetSkyAtmosphereAmbientContributionColorScale(AirSkyScatter * (1 - Immersion));
            HeightFog->SetVolumetricFog(bAirUsesVolume && Immersion < .75f);
        }
        if (Clouds && CloudInstance && CloudMaterial)
            Clouds->SetActorHiddenInGame(Immersion == 1 || Value(&FWeather::CloudDensity)+ClimateValue(&FClimate::Cloud) == 0.f);
        PreviousImmersion = Immersion;
    }
    bAtmosphereDirty = Strengths[Condition]<1.f || ClimateMix[Climate]<1.f;
    if (Yacht)
    {
        const float TargetScale = ClimateValue(&FClimate::Waves) + ClimateMix[0]*(Value(&FWeather::SeaScale)-1.f);
        SeaScale = Sailing::AdvanceSeaScale(SeaScale,TargetScale,DeltaSeconds);
        Yacht->SetSeaScale(SeaScale);
        Yacht->SetDeckLights(Strengths[3]+StormSky*.15f);
        const float DryingTime = RainStrength > SurfaceWetness ? 4.f : 38.f;
        SurfaceWetness = FMath::Lerp(SurfaceWetness,RainStrength,1.f-FMath::Exp(-DeltaSeconds/DryingTime));
        const float Film = FMath::RoundToFloat(SurfaceWetness*100.f)*.01f;
        Yacht->SetSurfaceWetness(Film);
        if (SeaActor) SeaActor->SetPrecipitation(RainStrength,Film);
        UpdateSpindrift(*Yacht,1-Immersion,Eye,Forward,Right);
        const auto Frame = Yacht->SeaFrame();
        const FVector Wind = Sailing::TrueWind(Frame.TimeS, Frame.Scale);
        if (CoastalWeather)
        {
            auto* Parameters = GetWorld()->GetParameterCollectionInstance(CoastalWeather);
            Parameters->SetVectorParameterValue(TEXT("WindAndRain"),FLinearColor(Wind.X,Wind.Y,Film,1.f));
            const auto& Explorer = Yacht->Explorer();
            const bool bWalking = Explorer.Mode() == ESkipperMode::Shore;
            const FVector FeetM = Explorer.ShoreFooting()*.01;
            Parameters->SetVectorParameterValue(TEXT("Walker"),bWalking
                ? FLinearColor(FeetM.X,FeetM.Y,FeetM.Z,1.f) : FLinearColor(0,0,0,0));
        }
        UpdateRain(RainStrength*(1-Immersion),DeltaSeconds,Eye,Right,Wind);
    }

    if (bCapture && CaptureFrame == 0)
    {
        if (Yacht)
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
}

void ASailingWeather::SetGraphicsQuality(int32 Level)
{
    GraphicsQuality = Level;
    if (Level < 2)
        for (int32 I=0; I<ShorePuffCount; ++I) SprayPuffs[FirstShorePuff+I].Born=-10.f;
    const bool bDetailed = Level >= 2;
    const bool bUltra = Level == 3;
    if (Sun)
    {
        auto* Light = Sun->FindComponentByClass<UDirectionalLightComponent>();
        Light->SetCastVolumetricShadow(bDetailed);
        Light->SetOcclusionDepthRange(bUltra ? 62000.f : 42000.f);
        Light->SetOcclusionMaskDarkness(bUltra ? .24f : .42f);
        Light->SetBloomScale(bUltra ? .29f : .18f);
        Light->SetBloomThreshold(1.7f);
        Light->CloudShadowStrength = bUltra ? .94f : bDetailed ? .87f : .78f;
        Light->CloudShadowOnSurfaceStrength = bDetailed ? .88f : .78f;
        Light->CloudShadowExtent = bDetailed ? 5.f : 10.f;
        Light->ContactShadowLengthInWS = true;
        // Screen-space contact rays hit the water prepass above the refracted bed.
        // The directional shadow map already resolves rocks, boats and foliage.
        Light->ContactShadowLength = 0.f;
        Light->ContactShadowCastingIntensity = .72f;
        Light->ContactShadowNonCastingIntensity = .18f;
        Light->MarkRenderStateDirty();
    }
    if (Sky) Sky->GetLightComponent()->SetVolumetricScatteringIntensity(bUltra ? .56f : bDetailed ? .68f : 1.f);
    if (Optics)
    {
        auto& Settings = Optics->Settings;
        Settings.bOverride_LensFlareIntensity = true;
        Settings.LensFlareIntensity = bUltra ? .22f : bDetailed ? .13f : 0.f;
        Settings.bOverride_LensFlareThreshold = true;
        Settings.LensFlareThreshold = 3.5f;
        Settings.bOverride_SceneFringeIntensity = true;
        Settings.SceneFringeIntensity = bUltra ? .35f : bDetailed ? .18f : 0.f;
        Settings.bOverride_ChromaticAberrationStartOffset = true;
        Settings.ChromaticAberrationStartOffset = .68f;
        Settings.bOverride_MotionBlurAmount = true;
        Settings.MotionBlurAmount = bUltra ? .23f : bDetailed ? .16f : Level == 1 ? .07f : 0.f;
        Settings.bOverride_MotionBlurMax = true;
        Settings.MotionBlurMax = 2.5f;
        Settings.bOverride_DepthOfFieldFstop = true;
        Settings.DepthOfFieldFstop = bUltra ? 2.2f : bDetailed ? 3.2f : 5.6f;
        Settings.bOverride_AmbientOcclusionIntensity = true;
        Settings.AmbientOcclusionIntensity = bDetailed ? .65f : Level == 1 ? .45f : 0.f;
        Settings.bOverride_LumenSceneLightingQuality = true;
        Settings.LumenSceneLightingQuality = bUltra ? 1.10f : 1.f;
        Settings.bOverride_LumenFinalGatherQuality = true;
        Settings.LumenFinalGatherQuality = 1.f;
        Settings.bOverride_LumenReflectionQuality = true;
        Settings.LumenReflectionQuality = bUltra ? 1.10f : 1.f;
        Settings.bOverride_ScreenSpaceReflectionQuality = bDetailed;
        Settings.ScreenSpaceReflectionQuality = bUltra ? 85.f : 68.f;
        Settings.bOverride_LocalExposureHighlightContrastScale = bDetailed;
        Settings.LocalExposureHighlightContrastScale = bUltra ? .82f : .90f;
        Settings.bOverride_LocalExposureShadowContrastScale = bDetailed;
        Settings.LocalExposureShadowContrastScale = bUltra ? .76f : .86f;
        Settings.bOverride_ColorContrast = true;
        Settings.ColorContrast = FVector4(1.f, 1.f, 1.f, bDetailed ? 1.04f : 1.f);
    }
    bAtmosphereDirty = true;
}

void ASailingWeather::UpdateRain(float Strength, float DeltaSeconds, const FVector& Eye, const FVector& Right, const FVector& Wind)
{
    Rain->SetVisibility(Strength > 0.02f);
    if (Strength <= .02f || !RainInstance) return;
    const FVector Drift(Wind.X*32., Wind.Y*32., -980.);
    RainTravel += Drift*DeltaSeconds;
    Rain->SetWorldLocation(Eye);
    RainInstance->SetVectorParameterValue(TEXT("RainEye"),FLinearColor(Eye.X,Eye.Y,Eye.Z));
    RainInstance->SetVectorParameterValue(TEXT("RainTravel"),FLinearColor(RainTravel.X,RainTravel.Y,RainTravel.Z));
    RainInstance->SetVectorParameterValue(TEXT("RainDrift"),FLinearColor(Drift.X,Drift.Y,Drift.Z));
    RainInstance->SetVectorParameterValue(TEXT("RainRight"),FLinearColor(Right.X,Right.Y,Right.Z,Strength));
}

void ASailingWeather::WhaleSpray(FVector SourceM, FVector Course, Sailing::FSeaFrame Frame, bool bBlow, float Strength)
{
    auto* Puffs = SprayPuffs + CrestPuffCount + 2*BowPuffsPerSide;
    const FVector Wind = Sailing::TrueWind(Frame.TimeS, Frame.Scale);
    const FVector Beam = FVector::CrossProduct(FVector::UpVector,Course);
    for (int32 I=0; I<WhalePuffCount; ++I)
    {
        auto& P = Puffs[I];
        P = {};
        const float Phase = (I+SprayRandom.FRand())/WhalePuffCount;
        const FVector Radial = Course.RotateAngleAxis(360.*Phase,FVector::UpVector);
        P.OriginM = SourceM + (bBlow ? Radial*.14 : Beam*SprayRandom.FRandRange(-1.7f,1.7f));
        P.Born = Frame.TimeS + Phase*(bBlow ? .56f : .18f);
        P.Seed = SprayRandom.FRand();
        P.Sheet = bBlow ? .08f : SprayRandom.FRandRange(.45f,.85f);
        P.Suspension = bBlow ? .85f : .05f;
        P.StormThrow = 1.f;
        P.VelocityMps = Radial*(bBlow ? .9 : 2.8) + Course*(bBlow ? 1.4 : .6);
        P.VelocityMps.Z = bBlow ? 5.7+1.5*P.Seed : (2.3+2.5*P.Seed)*FMath::Sqrt(Strength);
        P.WindMps = Wind*(bBlow ? .38 : .14);
        P.Life = bBlow ? 2.3f+.65f*P.Seed : 1.1f+.4f*P.Seed;
        P.WidthM = bBlow ? .29+.17*Phase : .55+.45*P.Seed;
        P.HeightM = bBlow ? .64+.35*Phase : .42+.42*P.Seed;
        P.Strength = bBlow ? .95f : .45f+.43f*Strength;
    }
}

void ASailingWeather::BreachSpray(const ASailingYachtPawn& Yacht, FVector SourceM, FVector Course, bool bLanding, float Force)
{
    auto* Puffs = SprayPuffs + CrestPuffCount + 2*BowPuffsPerSide + WhalePuffCount;
    const auto Frame = Yacht.SeaFrame();
    const FVector Wind = Sailing::TrueWind(Frame.TimeS, Frame.Scale);
    const FVector Beam = FVector::CrossProduct(FVector::UpVector, Course);
    const float Energy = FMath::Lerp(.64f, 1.f, Force);
    const int32 Count = bLanding ? BreachPuffCount : 12;
    for (int32 I = 0; I < Count; ++I)
    {
        auto& P = Puffs[I];
        P = {};
        const bool bMist = bLanding && I%4 == 0;
        P.Seed = SprayRandom.FRand();
        const float Along = SprayRandom.FRandRange(-1.f, 1.f);
        const float Across = SprayRandom.FRandRange(-1.f, 1.f);
        const float Azimuth = 360.f*(I + SprayRandom.FRand())/Count;
        const FVector Out = Course.RotateAngleAxis(Azimuth, FVector::UpVector);
        P.OriginM = SourceM + Course*(Along*(bLanding ? 5.6 : 2.4)) + Beam*Across*(bLanding ? 1.4 : .7);
        P.OriginM.Z = Yacht.RenderedSurfaceHeightM(FVector2D(P.OriginM)) + .14;
        // The flank drives a wide sheet, followed by finer spray that drifts downwind.
        P.Born = Frame.TimeS + (bLanding ? .02f + .14f*Along*Along + (bMist ? .13f : 0.f) : .15f*P.Seed);
        P.VelocityMps = Out*((bLanding ? 3.6 : 2.1) + 3.4*P.Seed)*Energy + Course*(bLanding ? 1.6 : 2.3);
        P.VelocityMps.Z = bLanding ? (bMist ? 2.7 + 2.7*P.Seed : 5.3 + 5.1*P.Seed)*Energy : 2.7 + 2.6*P.Seed;
        P.WindMps = Wind*(bMist ? .34 : .12);
        P.Life = bLanding ? (bMist ? 2.1f + .75f*P.Seed : 1.28f + .50f*P.Seed) : .78f + .44f*P.Seed;
        P.Suspension = bMist ? .50f : .04f;
        P.Sheet = bMist ? .10f : .88f;
        P.StormThrow = 1.f;
        P.WidthM = bLanding ? (bMist ? .8 + .85*P.Seed : .58 + .72*P.Seed) : .49 + .48*P.Seed;
        P.HeightM = bLanding ? .68 + .76*P.Seed : .45 + .54*P.Seed;
        P.Strength = bLanding ? (bMist ? .48f : .92f)*Energy : .76f;
    }
}

void ASailingWeather::SkipperSplash(const ASailingYachtPawn& Yacht,FVector ContactCm,FVector VelocityCmS,float Force,bool bEntry)
{
    auto* Slots = SprayPuffs + UE_ARRAY_COUNT(SprayPuffs) - SkipperPuffCount;
    const auto Frame = Yacht.SeaFrame();
    const FVector Wind = Sailing::TrueWind(Frame.TimeS,Frame.Scale);
    const FVector Course = VelocityCmS.GetSafeNormal2D();
    const FVector Travel(VelocityCmS.X*.01,VelocityCmS.Y*.01,0);
    const int32 Count = bEntry ? 9+FMath::RoundToInt(12*Force) : 3+FMath::RoundToInt(3*Force);
    const float Size = bEntry ? .54f+.46f*Force : .28f+.21f*Force;
    for (int32 I=0; I<Count; ++I)
    {
        auto& Puff = Slots[NextSkipperPuff];
        NextSkipperPuff = (NextSkipperPuff+1)%SkipperPuffCount;
        Puff = {};
        Puff.Seed = SprayRandom.FRand();
        const bool bMist = bEntry && I%4==0;
        const float Angle = UE_TWO_PI*(I+Puff.Seed)/Count;
        const FVector Out(FMath::Cos(Angle),FMath::Sin(Angle),0);
        const float Along = bEntry ? .91f+.37f*FVector::DotProduct(Out,Course) : .9f;
        Puff.OriginM = ContactCm*.01 + Out*(Size*SprayRandom.FRandRange(.11,.31));
        Puff.OriginM.Z = Yacht.RenderedSurfaceHeightM(FVector2D(Puff.OriginM)) + .035;
        Puff.Born = Frame.TimeS + (bMist ? .065f : 0.f) + .045f*Puff.Seed;
        Puff.VelocityMps = Out*(.51f+2.65f*Size)*Along + Travel*(bEntry ? .28 : .13);
        Puff.VelocityMps.Z = Size*(bMist ? 1.2f+1.5f*Puff.Seed : 2.8f+2.6f*Puff.Seed);
        Puff.WindMps = Wind*(bMist ? .14 : .035);
        Puff.Life = Size*(bMist ? .76f+.42f*Puff.Seed : .47f+.31f*Puff.Seed);
        Puff.Sheet = bMist ? .13f : .84f;
        Puff.StormThrow = .96f;
        Puff.Suspension = bMist ? .42f : 0.f;
        Puff.WidthM = Size*(bMist ? .32f+.24f*Puff.Seed : .10f+.13f*Puff.Seed);
        Puff.HeightM = Size*(bMist ? .23f+.22f*Puff.Seed : .20f+.30f*Puff.Seed);
        Puff.Strength = (bMist ? .45f : .89f)*(.38f+.62f*Force);
    }
}

Sailing::FSprayPuff* ASailingWeather::AcquireBowPuff(int32 Side, float Now, bool bStrike)
{
    auto* Slots = SprayPuffs + CrestPuffCount + Side*BowPuffsPerSide;
    int32 Oldest = NextBowPuff[Side];
    for (int32 J=0; J<BowPuffsPerSide; ++J)
    {
        const int32 Index = (NextBowPuff[Side]+J)%BowPuffsPerSide;
        const float End = Slots[Index].Born+Slots[Index].Life;
        if (End<=Now)
        {
            NextBowPuff[Side] = (Index+1)%BowPuffsPerSide;
            return &Slots[Index];
        }
        if (End < Slots[Oldest].Born+Slots[Oldest].Life) Oldest = Index;
    }
    // Continuous wash can wait. A new impact takes the most nearly spent slot.
    return bStrike ? &Slots[Oldest] : nullptr;
}

void ASailingWeather::EmitShoreSpray(Sailing::FSeaFrame Frame, const FVector& EyeM, const FVector& Forward,
                                     const FVector& Right, const FVector& Wind)
{
    const bool Ultra = GraphicsQuality==3;
    if (GraphicsQuality<2 || Frame.TimeS<NextShoreSpray || EyeM.Z>55.) return;
    NextShoreSpray=Frame.TimeS+(Ultra ? .068f : .12f);
    for (int32 Probe=0; Probe<(Ultra ? 14 : 9); ++Probe)
    {
        const float Ahead=ShoreRandom.FRandRange(1.6f,Ultra ? 52.f : 36.f);
        const FVector2D XY(EyeM + Forward*Ahead + Right*ShoreRandom.FRandRange(-Ahead,Ahead));
        Sailing::FShoreLip Lip;
        if (!Sailing::FindShoreLip(XY,Frame,Lip)) continue;
        BreakingSheets.BreakAt(Lip,Frame,Ultra,ShoreRandom.FRand());
        const FVector2D Ridge(-Lip.Shoreward.Y,Lip.Shoreward.X);
        const int32 Count = Ultra ? 5 : 3;
        for (int32 J=0; J<Count; ++J)
        {
            auto& Puff=SprayPuffs[FirstShorePuff+NextShorePuff];
            if (Frame.TimeS<Puff.Born+Puff.Life) return;
            NextShorePuff=(NextShorePuff+1)%ShorePuffCount;
            const FVector2D Point=FVector2D(Lip.PositionM)+Ridge*((J-.5*(Count-1))*.41);
            const float Strength=Lip.Aeration*ShoreRandom.FRandRange(.70f,1.f);
            Puff.OriginM=FVector(Point,Sailing::SeaHeight(Point,Frame,true)+.025);
            Puff.VelocityMps=FVector(Lip.Shoreward*(.82*Lip.SpeedMps),.70+1.42*Strength);
            Puff.WindMps=Wind*.20;
            Puff.Sheet=ShoreRandom.FRandRange(.68f,.90f);
            Puff.WidthM=.15f+.21f*Strength;
            Puff.HeightM=.072f+.12f*Strength;
            Puff.Born=Frame.TimeS;
            Puff.Life=.23f+.28f*Strength;
            Puff.Strength=Strength*.54f;
            Puff.Seed=ShoreRandom.FRand();
        }
        return;
    }
}

void ASailingWeather::UpdateSpindrift(const ASailingYachtPawn& Yacht,float Air,const FVector& Eye,const FVector& Forward,const FVector& Right)
{
    const auto Frame = Yacht.SeaFrame();
    if (Air < .01f)
    {
        Spindrift->SetVisibility(false);
        BreakerLips->SetVisibility(false);
        return;
    }
    const float Now = Frame.TimeS;
    const float Gale = FMath::SmoothStep(2.f,Sailing::HurricaneSeaScale,Frame.Scale);
    const FVector Wind = Sailing::TrueWind(Now,Frame.Scale);
    if (Yacht.HasCoralCoast()) EmitShoreSpray(Frame,Eye*.01,Forward,Right,Wind);
    BreakingSheets.Update(*BreakerLips,Frame,GraphicsQuality,Air);
    const FVector2D Downwind(Wind.GetSafeNormal2D());
    if (Gale>.02f && Now>=NextSprayTime)
    {
        NextSprayTime = Now+.095f;
        // Each broken crest lifts a short curtain along the ridge. Independent
        // puffs at unrelated probe positions otherwise look like smoke spots.
        for (int32 Probe=0; Probe<11; ++Probe)
        {
            const double Ahead = SprayRandom.FRandRange(4,108);
            const FVector2D XY(Eye*.01 + Forward*Ahead + Right*(SprayRandom.FRandRange(-1,1)*(.84*Ahead+6.)));
            const auto Sea = Sailing::SampleSea(XY,Now,0,Frame.Scale,Yacht.HasCoralCoast());
            const double Breaking = Sea.Compression-.57*FVector2D::DotProduct(Sea.Gradient,Downwind);
            if (Breaking < .30) continue;
            const FVector2D Ridge = FVector2D(-Sea.Gradient.Y,Sea.Gradient.X).GetSafeNormal();
            const int32 Count = Breaking>.47 ? 4 : 2;
            for (int32 J=0; J<Count; ++J)
            {
                auto& Puff = SprayPuffs[NextCrestPuff];
                if (Now < Puff.Born+Puff.Life) break;
                NextCrestPuff = (NextCrestPuff+1)%CrestPuffCount;
                const FVector2D Point = XY + Ridge*(J-.5*(Count-1))*1.4;
                Puff.OriginM = FVector(Point,Sailing::SeaHeight(Point,Frame,Yacht.HasCoralCoast())+.12);
                Puff.VelocityMps = Wind*.10 + Sea.VelocityMps*.23;
                Puff.VelocityMps.Z = SprayRandom.FRandRange(1.15f,2.5f);
                Puff.WindMps = Wind*SprayRandom.FRandRange(.30f,.53f);
                Puff.Born = Now;
                Puff.Life = SprayRandom.FRandRange(.78f,1.48f);
                Puff.WidthM = SprayRandom.FRandRange(.68f,1.42f);
                Puff.HeightM = SprayRandom.FRandRange(.32f,.69f);
                Puff.Strength = Gale*FMath::SmoothStep(.23,.57,Breaking);
                Puff.Sheet = SprayRandom.FRandRange(.05f,.24f);
                Puff.Seed = SprayRandom.FRand();
            }
        }
    }

    const auto BowWater = Yacht.BowContacts();
    for (int32 Side=0; Side<BowWater.Num(); ++Side)
    {
        const FBowContact& Contact = BowWater[Side];
        const bool bStrike = Contact.LastStrikeS>LastThrown[Side] && Now-Contact.LastStrikeS<.24f;
        if (!bStrike && (Contact.Sheet<.13f || Now<NextSheet[Side])) continue;
        LastThrown[Side]=Contact.LastStrikeS;
        NextSheet[Side]=Now+FMath::Lerp(.28f,.14f,Contact.Sheet);
        const FVector Origin = bStrike ? Contact.StrikeM : Contact.WaterlineM;
        if (FVector::DistSquared(Origin,Eye*.01)>100.*100.) continue;
        // Throw a fan out from the hull that actually entered the wave. The
        // outer droplets follow a ballistic arc while mist accelerates downwind.
        const FVector Beam = Yacht.GetActorRightVector().GetSafeNormal2D()*(Side ? 1. : -1.);
        const FVector Bow = Yacht.GetActorForwardVector().GetSafeNormal2D();
        const FVector BoatMps = Yacht.GetVelocity()*.01;
        const float Energy = bStrike ? FMath::SmoothStep(.48f,3.8f,Contact.StrikeMps) : .74f*Contact.Sheet;
        const int32 Count = bStrike ? 4+FMath::RoundToInt(13*Energy) : 2+FMath::RoundToInt(2*Energy);
        for (int32 J=0; J<Count; ++J)
        {
            auto* Puff = AcquireBowPuff(Side,Now,bStrike);
            if (!Puff) break;
            const float Fan = (J+SprayRandom.FRand())/Count;
            // The fast fringe leaves first. The stem keeps feeding the inner
            // sheet for part of a second as it travels through the wave.
            const float Delay=bStrike ? .27f*Gale*Energy*(1.f-Fan) : 0.f;
            const FVector Source=Origin+FVector(BoatMps.X,BoatMps.Y,0)*Delay;
            Puff->LaunchFromBow(Source,Beam,Bow,BoatMps,Wind,bStrike ? Contact.LastStrikeS+Delay : Now,
                                Energy,Gale,Fan,J%3==0,SprayRandom);
        }
    }

    bool bHasSpray=false;
    for (int32 I=0; I<UE_ARRAY_COUNT(SprayPuffs); ++I)
    {
        const auto& Puff = SprayPuffs[I];
        const int32 V=4*I;
        const float Age=Now-Puff.Born;
        if (Age<0 || Age>=Puff.Life)
        {
            // Collapse spent quads to avoid submitting invisible cloud-sized fragments.
            for (int32 J=0; J<4; ++J) SprayVertices[V+J]=Eye;
            continue;
        }
        bHasSpray=true;
        const float Life=Age/Puff.Life;
        const float Alpha=Air*Puff.Opacity(Life);
        const FVector Center=Puff.PositionM(Age);
        const FVector Width=Right*(Puff.WidthM*(.68+(1.57+1.75*Puff.Suspension)*Life));
        const FVector Launch(Puff.VelocityMps.X,Puff.VelocityMps.Y,0.);
        const FVector Lift=FVector::UpVector*(Puff.HeightM*(.74+(1.12+.55*Puff.Suspension)*Life))
            + Puff.WindMps*(.04+(.07+.15*Puff.Suspension)*Life) + Launch*(.09*Puff.StormThrow*(1.-Life));
        const float Attached=Puff.Sheet>.5f ? Puff.StormThrow*(1.f-FMath::SmoothStep(.12f,.65f,Age)) : 0.f;
        const FVector Foot=FMath::Lerp(Center-Lift,Puff.OriginM,Attached);
        const FVector FootWidth=Width*(1.-.60*Attached);
        SprayVertices[V]=(Foot-FootWidth)*100.;
        SprayVertices[V+1]=(Foot+FootWidth)*100.;
        SprayVertices[V+2]=(Center-Width+Lift)*100.;
        SprayVertices[V+3]=(Center+Width+Lift)*100.;
        // Tags below the crest-mist range select the detached veil in the atlas.
        const float SheetTag=Puff.Sheet*(1.f-FMath::Min(1.f,1.6f*Puff.Suspension));
        const FLinearColor Color(SheetTag,Puff.Seed,Life,Alpha);
        for (int32 J=0; J<4; ++J) SprayColors[V+J]=Color;
    }
    Spindrift->SetVisibility(bHasSpray);
    if (!bHasSpray) return;
    Spindrift->UpdateMeshSection_LinearColor(0,SprayVertices,{},SprayUVs,SprayColors,{},false);
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
