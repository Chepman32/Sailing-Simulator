#include "SailingWake.h"
#include "Components/PrimitiveComponent.h"
#include "Engine/Texture2D.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "SailingTrial.h"

ASailingWake::ASailingWake()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PostPhysics;
}

void ASailingWake::BeginPlay()
{
    Super::BeginPlay();
    Sea = Cast<ASailingSea>(UGameplayStatics::GetActorOfClass(this,ASailingSea::StaticClass()));
    constexpr auto Size = Sailing::FFoamField::Size;
    TArray64<uint8> Empty;
    Empty.SetNumZeroed(Size*Size*4);
    for (auto& Map : Maps)
    {
        Map = UTexture2D::CreateTransient(Size,Size,PF_B8G8R8A8,NAME_None,Empty);
        Map->SRGB=false;
        Map->Filter=TF_Bilinear;
        Map->AddressX=Map->AddressY=TA_Wrap;
        Map->NeverStream=true;
        Map->UpdateResource();
    }
}

void ASailingWake::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    const auto* Yacht = Cast<ASailingYachtPawn>(UGameplayStatics::GetPlayerPawn(this,0));
    UMaterialInstanceDynamic* Water = Sea ? Sea->SurfaceMaterial() : nullptr;
    if (!Water || !Yacht) return;
    if (BoundWater.Get()!=Water)
    {
        Water->SetTextureParameterValue(TEXT("WakeFieldA"),Maps[0]);
        Water->SetTextureParameterValue(TEXT("WakeFieldB"),Maps[1]);
        BoundWater=Water;
    }
    const FVector2D Bow(Yacht->GetActorForwardVector().GetSafeNormal2D());
    const UPrimitiveComponent* Hull = CastChecked<UPrimitiveComponent>(Yacht->GetRootComponent());
    const FVector Heading(Bow,0);
    const auto Surge = [&](double Side)
    {
        const FVector Point = Yacht->GetActorTransform().TransformPositionNoScale({-470,Side*193,-28});
        return float(FVector::DotProduct(Hull->GetPhysicsLinearVelocityAtPoint(Point),Heading)*.01);
    };
    const auto& Helm = Yacht->ReadHelm();
    const float Now = Yacht->SeaFrame().TimeS;
    const bool Reset = Field.Record({FVector2D(Yacht->GetActorLocation())*.01,Bow,Surge(-1),Surge(1),
        float(Helm.bEngineOn ? Helm.Throttle : 0)},Now);
    constexpr int32 Size = Sailing::FFoamField::Size;
    constexpr float Interval = Sailing::FFoamField::Interval;
    if (Reset || Now-Published>=Interval)
    {
        Latest=1-Latest;
        auto Pixels=MakeShared<TArray<FColor>,ESPMode::ThreadSafe>();
        Field.Rasterize(*Pixels);
        static const FUpdateTextureRegion2D Region(0,0,0,0,Size,Size);
        const auto Upload = [&](UTexture2D* Map)
        {
            // Each upload owns its pixels until the render thread consumes them.
            Map->UpdateTextureRegions(0,1,&Region,Size*sizeof(FColor),sizeof(FColor),
                reinterpret_cast<uint8*>(Pixels->GetData()),[Pixels](uint8*,const FUpdateTextureRegion2D*){});
        };
        Upload(Maps[Latest]);
        if (Reset) Upload(Maps[1-Latest]);
        Published=Now;
    }
    const float Fraction=FMath::Clamp((Now-Published)/Interval,0.f,1.f);
    const FVector2D Center=Field.Center();
    Water->SetVectorParameterValue(TEXT("WakeFieldView"),FLinearColor(Center.X,Center.Y,
        1.f/Sailing::FFoamField::Metres,Latest ? Fraction : 1.f-Fraction));
}
