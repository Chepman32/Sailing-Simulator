#include "SailingWeather.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/PlayerController.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "ProceduralMeshComponent.h"

namespace
{
constexpr int32 ClothSections=30, SmokeSections=40;
TArray<int32> StripIndices(int32 Sections)
{
    TArray<int32> Indices;
    for (int32 I=0; I<Sections; ++I)
    {
        const int32 A=2*I;
        Indices.Append({A,A+1,A+2,A+2,A+1,A+3});
    }
    return Indices;
}
}

void ASailingWeather::PrepareAircraft()
{
    auto Prepare=[&](int32 Sections, UProceduralMeshComponent& Mesh, TArray<FVector>& Positions,TArray<FVector2D>& UVs,
                     const TArray<FLinearColor>& Colors) {
        Positions.SetNumZeroed(2*(Sections+1));
        for (int32 I=0; I<=Sections; ++I)
        {
            UVs.Emplace(double(I)/Sections,0.);
            UVs.Emplace(double(I)/Sections,1.);
        }
        Mesh.CreateMeshSection_LinearColor(0,Positions,StripIndices(Sections),{},UVs,Colors,{},false);
    };
    Prepare(ClothSections,*TowBanner,BannerVertices,BannerUVs,{});
    BannerNormals.SetNumUninitialized(BannerVertices.Num());
    SmokeColors.Init(FLinearColor::White,2*(SmokeSections+1));
    Prepare(SmokeSections,*DisplaySmoke,SmokeVertices,SmokeUVs,SmokeColors);
    // The two tow lines meet at the tail and tension the leading batten.
    TArray<FVector> Cord;
    Cord.SetNumZeroed(8);
    TArray<FLinearColor> CordPaint;
    CordPaint.Init(FLinearColor(.24,.19,.12),8);
    TowBanner->CreateMeshSection_LinearColor(1,Cord,{0,1,2,2,1,3,4,5,6,6,5,7},{},{},CordPaint,{},false);
}

FVector ASailingWeather::FlightPosition(double Age, bool Stunt) const
{
    const double Speed=Stunt ? 39. : 28.;
    FVector P=FlightOrigin+FlightAxis*((Age-16.)*Speed);
    P.Z=FlightAltitude + 3.*FMath::Sin(Age*.15);
    if (Stunt)
    {
        const double Phase=(Age-14.)/5.;
        const double Pullup=FMath::Exp(-Phase*Phase);
        P+=FlightAcross*(13.*FMath::Sin(Age*.23));
        P.Z+=37.*Pullup;
    }
    return P;
}

void ASailingWeather::UpdateBanner(double Age)
{
    const FVector Tow=FlightPosition(Age,false)-4.8*FlightAxis;
    const FVector Nose=Tow-32.*FlightAxis-FVector(0,0,5.);
    for (int32 I=0; I<=ClothSections; ++I)
    {
        const double U=double(I)/ClothSections;
        const double Flutter=U*(1.1*FMath::Sin(13.*U-4.3*Age)+.38*FMath::Sin(24.*U-6.8*Age));
        FVector Top=Nose-FlightAxis*(46.*U)+FlightAcross*Flutter;
        Top.Z+=.42*Flutter-.75*U;
        BannerVertices[2*I]=Top*100.;
        BannerVertices[2*I+1]=(Top-FVector(0,0,7.4)+FlightAcross*(.33*Flutter))*100.;
    }
    for (int32 I=0; I<=ClothSections; ++I)
    {
        const FVector Along=BannerVertices[2*FMath::Min(I+1,ClothSections)]-BannerVertices[2*FMath::Max(0,I-1)];
        const FVector Down=BannerVertices[2*I+1]-BannerVertices[2*I];
        BannerNormals[2*I]=BannerNormals[2*I+1]=FVector::CrossProduct(Along,Down).GetSafeNormal();
    }
    TowBanner->UpdateMeshSection_LinearColor(0,BannerVertices,BannerNormals,BannerUVs,{},{});
    TArray<FVector> Cord;
    for (int32 I=0; I<2; ++I)
    {
        FVector A=Tow*100., B=BannerVertices[I], Width(0,0,5.);
        Cord.Append({A-Width,A+Width,B-Width,B+Width});
    }
    TowBanner->UpdateMeshSection_LinearColor(1,Cord,{},{},{},{});
}

void ASailingWeather::UpdateSmoke(double Age,const FVector& Eye)
{
    for (int32 I=0; I<=SmokeSections; ++I)
    {
        const double U=double(I)/SmokeSections, Elapsed=FMath::Min(Age,7.5)*U;
        const double Birth=Age-Elapsed;
        FVector P=FlightPosition(Birth,true)-FlightAxis*3.8;
        P+=FlightAcross*(Elapsed*(.84+.51*FMath::Sin(.85*Birth)));
        P.Z+=Elapsed*(.48+.33*FMath::Sin(1.7*Birth));
        const FVector Tangent=FlightPosition(Birth+.02,true)-FlightPosition(Birth-.02,true);
        const FVector Width=FVector::CrossProduct(Tangent,Eye*.01-P).GetSafeNormal()*(.48+.34*Elapsed);
        SmokeVertices[2*I]=(P-Width)*100.;
        SmokeVertices[2*I+1]=(P+Width)*100.;
        SmokeColors[2*I].A=SmokeColors[2*I+1].A=.84f*(1-U*U)*FMath::SmoothStep(0.,.6,Birth);
    }
    DisplaySmoke->UpdateMeshSection_LinearColor(0,SmokeVertices,{},SmokeUVs,SmokeColors,{});
}

void ASailingWeather::UpdateAircraft(float Time, const FVector& Eye)
{
    const int32 Pass=FMath::FloorToInt(Time/41.);
    const double Age=Time-Pass*41.;
    const bool Stunt=Pass%4==1, Banner=Pass%4==0 || Pass%4==2;
    if (Pass!=FlightNumber)
    {
        FlightNumber=Pass;
        auto* Player=GetWorld()->GetFirstPlayerController();
        FlightAcross=Player->PlayerCameraManager->GetCameraRotation().Vector().GetSafeNormal2D();
        if (FlightAcross.IsNearlyZero()) FlightAcross=FVector::ForwardVector;
        FlightAxis=FVector::CrossProduct(FVector::UpVector,FlightAcross)*(Pass%2 ? -1. : 1.);
        FlightOrigin=Eye*.01+FlightAcross*(Stunt ? 105. : 126.);
        FlightAltitude=FMath::Max(48.,Eye.Z*.01+36.);
        FCollisionQueryParams Query(SCENE_QUERY_STAT(SailingFlightClearance),false,this);
        for (int32 I=-4; I<=6; ++I)
        {
            const FVector P=(FlightOrigin+FlightAxis*(I*110.))*100.;
            FHitResult Ground;
            if (GetWorld()->LineTraceSingleByChannel(Ground,FVector(P.X,P.Y,140000),FVector(P.X,P.Y,0),
                ECC_WorldStatic,Query)) FlightAltitude=FMath::Max(FlightAltitude,Ground.ImpactPoint.Z*.01+(Banner?31.:24.));
        }
    }
    const bool Visible=Condition!=3 && Age<38.;
    Floatplane->SetVisibility(Visible && !Stunt);
    StuntPlane->SetVisibility(Visible && Stunt);
    TowBanner->SetVisibility(Visible && Banner);
    DisplaySmoke->SetVisibility(Visible && Stunt);
    if (Visible)
    {
        auto* Plane=Stunt ? StuntPlane.Get() : Floatplane.Get();
        const FVector P=FlightPosition(Age,Stunt);
        const FVector Direction=FlightPosition(Age+.02,Stunt)-FlightPosition(Age-.02,Stunt);
        FRotator Rotation=Direction.Rotation();
        Rotation.Roll=Stunt ? -360.*FMath::SmoothStep(10.,16.,Age)-21.*FMath::Sin(Age*.23) : 4.*FMath::Sin(Age*.20);
        Plane->SetWorldLocationAndRotation(P*100.,Rotation);
        if (Banner) UpdateBanner(Age);
        if (Stunt) UpdateSmoke(Age,Eye);
    }
    const FVector Course(.932327,.361615,0.);
    const double Run=FMath::Fmod(Time*172.+18400.,38000.);
    const FVector Jet=FVector(80.,-1250.,2700.)+Course*(Run-19000.);
    Airliner->SetWorldLocationAndRotation(Jet*100.,Course.Rotation());
    if (DistantSky) DistantSky->SetVectorParameterValue(TEXT("JetTrack"),FLinearColor(Jet.X,Jet.Y,Jet.Z,Run/172.));
}
