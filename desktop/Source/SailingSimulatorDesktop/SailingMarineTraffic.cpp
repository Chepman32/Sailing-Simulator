#include "SailingMarineTraffic.h"
#include "SailingTrial.h"
#include "SailingJetSki.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/Texture2D.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
struct FLane
{
    FVector2D Center;
    double Radius, Start, Speed, Length, Beam, DraftOffset;
};
// These deep-water loops clear the island shelves, berths and the volcano.
const FLane Lanes[]={
    {{-695,-770},805,.81,6.8,176,29,-.24},
    {{1020,1580},600,-1.82,-8.4,184,31,-.15}
};
FVector2D Position(const FLane& Lane,double T,FVector2D& Forward)
{
    const double Angle=Lane.Start+T*Lane.Speed/Lane.Radius;
    const FVector2D Arm(FMath::Cos(Angle),FMath::Sin(Angle));
    Forward=FVector2D(-Arm.Y,Arm.X)*FMath::Sign(Lane.Speed);
    return Lane.Center+Arm*Lane.Radius;
}
constexpr int32 Width=Sailing::FTrafficTrail::Samples*2+2;
}

USailingMarineTraffic::USailingMarineTraffic()
{
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Tanker(TEXT("/Game/Coastal/Meshes/SM_ProductTanker"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Carrier(TEXT("/Game/Coastal/Meshes/SM_GasCarrier"));
    Hulls[0]=Tanker.Object;
    Hulls[1]=Carrier.Object;
}
void USailingMarineTraffic::Launch(ASailingYachtPawn& Yacht)
{
    check(Yacht.JetSkis().Num()<=Sailing::FTrafficWater::JetSkiCount);
    constexpr int32 Height=Sailing::FTrafficWater::Capacity;
    TrackMap=UTexture2D::CreateTransient(Width,Height,PF_A32B32G32R32F);
    TrackMap->SRGB=false;
    TrackMap->Filter=TF_Nearest;
    TrackMap->NeverStream=true;
    TrackMap->UpdateResource();
    for (int32 I=0; I<UE_ARRAY_COUNT(Lanes); ++I)
    {
        const FLane& L=Lanes[I];
        FVector2D Dir;
        const FVector2D P=Position(L,0,Dir);
        auto* Ship=GetWorld()->SpawnActor<AStaticMeshActor>(FVector(P*100.,L.DraftOffset*100.),FVector(Dir,0).Rotation());
        Ships.Add(Ship);
        if (!Ship) continue;
        auto* Body=Ship->GetStaticMeshComponent();
        Body->SetMobility(EComponentMobility::Movable);
        Body->SetStaticMesh(Hulls[I]);
        Body->SetCollisionProfileName(TEXT("BlockAllDynamic"));
        Ship->Tags.Add(TEXT("SailingUnderway"));
        // Traffic has been under way before the player arrives.
        auto& Trail=Wakes.Trails[I];
        Trail.LengthM=L.Length; Trail.BeamM=L.Beam;
        for (int32 T=-60; T<=0; ++T)
        {
            const FVector2D Center=Position(L,T,Dir);
            Trail.Record(Center-Dir*(L.Length*.47),Dir,FMath::Abs(L.Speed),.8f,T);
        }
    }
}

AStaticMeshActor* USailingMarineTraffic::FirstShip() const
{
    return Ships.Num() ? Ships[0].Get() : nullptr;
}

void USailingMarineTraffic::Advance(const ASailingYachtPawn& Yacht,float Time)
{
    if (!TrackMap) return;
    for (int32 I=0; I<Ships.Num(); ++I)
    {
        if (!IsValid(Ships[I])) continue;
        const FLane& L=Lanes[I];
        FVector2D Dir;
        const FVector2D P=Position(L,Time,Dir);
        const FVector2D Across(-Dir.Y,Dir.X);
        // A long hull averages the sea at separated stations.
        const auto Frame=Yacht.SeaFrame();
        const double Bow=Sailing::SeaHeight(P+Dir*(.35*L.Length),Frame,true);
        const double Stern=Sailing::SeaHeight(P-Dir*(.35*L.Length),Frame,true);
        const double Side=Sailing::SeaHeight(P+Across*(.43*L.Beam),Frame,true);
        FRotator Rot=FVector(Dir,0).Rotation();
        Rot.Pitch=FMath::RadiansToDegrees(FMath::Atan2(Bow-Stern,.70*L.Length))*.55;
        Rot.Roll=FMath::Clamp((Side-(Bow+Stern)*.5)/L.Beam*36.,-3.,3.);
        Ships[I]->SetActorLocationAndRotation(FVector(P*100.,100*(L.DraftOffset+.28*(Bow+Stern))),Rot);
        Wakes.Trails[I].Record(P-Dir*(L.Length*.47),Dir,FMath::Abs(L.Speed),.8f,Time);
    }
    auto& Cat=Wakes.Trails[2];
    Cat.LengthM=11.2f; Cat.BeamM=4.65f;
    const auto Boat=Yacht.BoatWake();
    Cat.Record(Boat.SternM,Boat.Forward,Boat.SpeedMps,0.f,Time);
    // Every moving or coasting ski retains its own emission history.
    for (int32 I=0; I<Yacht.JetSkis().Num(); ++I)
    {
        const ASailingJetSki* Ski=Yacht.JetSkis()[I];
        if (!IsValid(Ski)) continue;
        auto& Trail=Wakes.Trails[3+I];
        const auto& Drive=Ski->Drive();
        const auto Dir=Drive.SurgeMps()<0 ? -Drive.Bow() : Drive.Bow();
        const FVector2D Stern=FVector2D(Ski->GetActorLocation())*.01-Dir*1.45;
        Trail.LengthM=3.15f; Trail.BeamM=1.16f;
        Trail.Record(Stern,Dir,Drive.SpeedMps(),FMath::Abs(Drive.Jet),Time);
    }
}
void USailingMarineTraffic::Publish(UMaterialInstanceDynamic& Water,float Time)
{
    if (!TrackMap) return;
    const bool New=BoundWater.Get()!=&Water;
    if (!New && Time>=LastUpload && Time-LastUpload<1.f/20.f) return;
    LastUpload=Time;
    auto Data=MakeShared<TArray<FLinearColor>,ESPMode::ThreadSafe>();
    Data->SetNumZeroed(Width*Sailing::FTrafficWater::Capacity);
    static const FName Names[]={TEXT("TrainBox0"),TEXT("TrainBox1"),TEXT("TrainBox2"),TEXT("TrainBox3")};
    FBox2D Skis(ForceInit);
    for (int32 I=0; I<Sailing::FTrafficWater::Capacity; ++I)
    {
        const auto& Trail=Wakes.Trails[I];
        const auto& Box=Trail.Bounds;
        const FLinearColor Bounds=Box.bIsValid ? FLinearColor(Box.Min.X,Box.Min.Y,Box.Max.X,Box.Max.Y)
                : FLinearColor(1,1,-1,-1);
        if (I<3) Water.SetVectorParameterValue(Names[I],Bounds);
        else if (Box.bIsValid) Skis+=Box;
        const int32 Row=I*Width;
        (*Data)[Row+Width-1]=Bounds;
        (*Data)[Row]={Trail.LengthM,Trail.BeamM,0,0};
        for (int32 J=0; J<Sailing::FTrafficTrail::Samples; ++J)
        {
            (*Data)[Row+1+2*J]=Trail.Mark[J];
            (*Data)[Row+2+2*J]=Trail.Axis[J];
        }
    }
    Water.SetVectorParameterValue(Names[3],Skis.bIsValid ? FLinearColor(Skis.Min.X,Skis.Min.Y,Skis.Max.X,Skis.Max.Y) : FLinearColor(1,1,-1,-1));
    static const FUpdateTextureRegion2D Region(0,0,0,0,Width,Sailing::FTrafficWater::Capacity);
    TrackMap->UpdateTextureRegions(0,1,&Region,Width*sizeof(FLinearColor),sizeof(FLinearColor),
        reinterpret_cast<uint8*>(Data->GetData()),[Data](uint8*,const FUpdateTextureRegion2D*){});
    if (New) { Water.SetTextureParameterValue(TEXT("TrainTracks"),TrackMap); BoundWater=&Water; }
}
void USailingMarineTraffic::EndPlay(const EEndPlayReason::Type Reason)
{
    for (AStaticMeshActor* Ship : Ships) if (IsValid(Ship)) Ship->Destroy();
    Super::EndPlay(Reason);
}
