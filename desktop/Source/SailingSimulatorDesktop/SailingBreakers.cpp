#include "SailingBreakers.h"
#include "ProceduralMeshComponent.h"

namespace Sailing
{
void FBreakingSheets::Initialize(UProceduralMeshComponent& Mesh)
{
    constexpr int32 Vertices=Count*Columns*Rows;
    Positions.SetNumZeroed(Vertices);
    Normals.Init(FVector::UpVector,Vertices);
    Colors.Init(FLinearColor::Transparent,Vertices);
    TArray<int32> Indices;
    for (int32 S=0; S<Count; ++S)
        for (int32 C=0; C<Columns; ++C)
            for (int32 R=0; R<Rows; ++R)
            {
                const int32 V=UVs.Add({double(C)/(Columns-1),double(R)/(Rows-1)});
                if (R+1<Rows && C+1<Columns)
                    Indices.Append({V,V+Rows,V+1,V+1,V+Rows,V+Rows+1});
            }
    Mesh.CreateMeshSection_LinearColor(0,Positions,Indices,Normals,UVs,Colors,{},false);
}

void FBreakingSheets::BreakAt(const FShoreLip& Lip, FSeaFrame Frame, bool Ultra, float Seed)
{
    if (Lip.Aeration<.34f) return;
    const FVector2D Center(Lip.PositionM);
    FSheet* Free=nullptr;
    for (int32 I=0; I<(Ultra ? Count : 3); ++I)
    {
        auto& S=Sheets[I];
        if (Frame.TimeS>=S.Born+S.Life) Free=&S;
        else if (FVector2D::DistSquared(Center,S.CenterM)<FMath::Square(S.HalfSpanM+2.5)) return;
    }
    if (Free) *Free={Center,Frame.TimeS,1.38f+.50f*Seed,1.6f+2.4f*Lip.Aeration,Seed,Lip.Shoreward,Lip.SpeedMps,Lip.Aeration,Frame.TimeS};
}

void FBreakingSheets::Update(UProceduralMeshComponent& Mesh, FSeaFrame Frame, int32 Quality, float Air)
{
    // Section from the seaward shoulder, over the crown and back under the
    // falling tip. Its ends taper into the water while the middle throws.
    static constexpr double Across[Rows]={-.95,-.54,-.18,.16,.42,.65,.71,.60};
    static constexpr double Above[Rows]={-.22,-.055,.115,.275,.335,.26,.07,-.14};
    bool Visible=false;
    for (int32 I=0; I<Count; ++I)
    {
        FSheet& S=Sheets[I];
        float Age=Frame.TimeS-S.Born;
        FShoreLip Lip;
        if (Quality<2 || (Quality==2 && I>=3) || Air<.01f || Age<0 || Age>=S.Life)
        {
            if (S.Life>0)
            {
                for (int32 V=I*Columns*Rows; V<(I+1)*Columns*Rows; ++V)
                    Positions[V]=FVector(S.CenterM*100.,0.);
                S.Life=0;
            }
            continue;
        }
        Visible=true;
        const double Dt=FMath::Clamp(double(Frame.TimeS-S.LastUpdate),0.,.12);
        const FVector2D Expected=S.CenterM+S.Shoreward*(S.SpeedMps*Dt);
        if (FindShoreLip(Expected,Frame,Lip))
        {
            // Follow this section of crest continuously, including when a
            // closer phase solution appears on the opposite flank of a rock.
            S.CenterM=Expected+(FVector2D(Lip.PositionM)-Expected).GetClampedToMaxSize(.7*Dt);
            S.Shoreward=FMath::Lerp(S.Shoreward,Lip.Shoreward,1.-FMath::Exp(-5.*Dt)).GetSafeNormal();
            S.SpeedMps=FMath::Lerp(S.SpeedMps,Lip.SpeedMps,float(1.-FMath::Exp(-4.*Dt)));
            S.Air=FMath::Lerp(S.Air,Lip.Aeration,float(1.-FMath::Exp(-5.*Dt)));
        }
        else
        {
            S.CenterM=Expected;
            S.Air*=FMath::Exp(-4.*Dt);
        }
        S.LastUpdate=Frame.TimeS;
        Lip.Shoreward=S.Shoreward;
        Lip.Aeration=S.Air;
        const FVector2D Along(-Lip.Shoreward.Y,Lip.Shoreward.X);
        const double Phase=Age/S.Life;
        // Project a few points onto the same curved crest as the water mesh.
        // The ends of a sheet can meet opposite flanks of a rock at different times.
        FVector2D Ridge[4], Shoreward[4];
        double Wet[4];
        for (int32 A=0; A<4; ++A)
        {
            const FVector2D Probe=S.CenterM+Along*((2.*A/3.-1.)*S.HalfSpanM);
            FShoreLip Local;
            const bool OnCrest=FindShoreLip(Probe,Frame,Local) && FVector2D::DistSquared(Probe,FVector2D(Local.PositionM))<2.25;
            Ridge[A]=OnCrest ? FVector2D(Local.PositionM) : Probe;
            Shoreward[A]=OnCrest ? Local.Shoreward : Lip.Shoreward;
            Wet[A]=OnCrest ? 1. : FMath::Clamp(double(S.Air),0.,1.);
            if (OnCrest) Ridge[A]=Probe+(Ridge[A]-Probe).GetClampedToMaxSize(.65);
        }
        for (int32 C=0; C<Columns; ++C)
        {
            const double U=2.*C/(Columns-1)-1.;
            const double Taper=FMath::Max(0.,1.-U*U);
            const int32 A=FMath::Min(C/4,2);
            const double Mix=(C-4*A)*.25;
            const FVector2D P=FMath::Lerp(Ridge[A],Ridge[A+1],Mix);
            const FVector2D Dir=FMath::Lerp(Shoreward[A],Shoreward[A+1],Mix).GetSafeNormal();
            const double Stage=FMath::Clamp((Phase-.18*(.5+.5*U*(S.Seed>.5 ? 1. : -1.)))/.82,0.,1.);
            const double Growth=FMath::SmoothStep(0.,.35,Stage)*(1.-FMath::SmoothStep(.78,1.,Stage));
            const double Crest=SeaHeight(P,Frame,true);
            const double Throw=Growth*Taper*(.35+.8*Lip.Aeration)*(.9+.1*FMath::Cos(5.*U+S.Seed*7.));
            for (int32 R=0; R<Rows; ++R)
            {
                const int32 V=(I*Columns+C)*Rows+R;
                const double Curl=FMath::Square(FMath::SmoothStep(.30,1.,Stage))*.75;
                const double Tip=double(R)/(Rows-1), Fall=Curl*Tip*Tip;
                // The thin leading sheet gains reach as it rolls over, then
                // loses height under gravity while the crest continues inland.
                const double Reach=.26*FMath::SmoothStep(.25,.77,Stage)*Tip*Tip;
                Positions[V]=100.*FVector(P+Dir*((Across[R]+Reach)*Throw),Crest+(Above[R]-Fall)*Throw);
                const int32 Lo=FMath::Max(0,R-1), Hi=FMath::Min(Rows-1,R+1);
                const double Drop=Curl*(Hi*Hi-Lo*Lo)/FMath::Square(double(Rows-1));
                const double Extension=.26*FMath::SmoothStep(.25,.77,Stage)*(Hi*Hi-Lo*Lo)/FMath::Square(double(Rows-1));
                Normals[V]=(FVector::UpVector*(Across[Hi]-Across[Lo]+Extension)-FVector(Dir,0.)*(Above[Hi]-Above[Lo]-Drop)).GetSafeNormal();
                Colors[V]=FLinearColor(Lip.Aeration,S.Seed,Stage,Air*Growth*Taper*FMath::Lerp(Wet[A],Wet[A+1],Mix));
            }
        }
    }
    Mesh.SetVisibility(Visible);
    if (Visible) Mesh.UpdateMeshSection_LinearColor(0,Positions,Normals,UVs,Colors,{});
}
}
