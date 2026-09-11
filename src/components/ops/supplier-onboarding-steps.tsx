"use client";

import { CircleHelp } from "lucide-react";
import {
  Button,
  Input,
  Label,
  Textarea,
} from "@/components/ui/primitives";
import type {
  DocReadinessStatus,
  ExportReadinessClass,
  SupplierHubApplication,
} from "@/types/trade";
import {
  classifyReadiness,
  readinessClassLabel,
  recomputeAssessmentTotal,
} from "@/lib/trade/supplierOnboarding";
import { PH, TIP, type FieldErrors } from "@/lib/trade/supplierFormGuide";
import { cn } from "@/lib/utils";

export function Tip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        className="inline-flex text-zinc-400 hover:text-teal-700"
        aria-label={text}
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-60 -translate-x-1/2 rounded-md bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export function Field({
  label,
  tip,
  error,
  required,
  children,
}: {
  label: string;
  tip?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <Label>
          {label}
          {required ? <span className="text-red-600"> *</span> : null}
        </Label>
        {tip ? <Tip text={tip} /> : null}
      </div>
      {children}
      {error ? (
        <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p>
      ) : null}
    </div>
  );
}

export function inputCls(error?: string, className?: string) {
  return cn(
    error && "border-red-400 focus:border-red-500 focus:ring-red-500",
    className,
  );
}

export function selectCls(error?: string) {
  return cn(
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm",
    error && "border-red-400",
  );
}

export function CheckGroup({
  options,
  value,
  onChange,
  error,
}: {
  options: string[];
  value: string[] | undefined;
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const selected = value || [];
  return (
    <div>
      <div
        className={cn(
          "flex flex-wrap gap-2 rounded-md p-0.5",
          error && "ring-1 ring-red-300",
        )}
      >
        {options.map((opt) => {
          const on = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() =>
                onChange(
                  on ? selected.filter((x) => x !== opt) : [...selected, opt],
                )
              }
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                on
                  ? "border-teal-700 bg-teal-50 text-teal-900"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p>
      ) : null}
    </div>
  );
}

function DocStatusSelect({
  value,
  onChange,
  error,
}: {
  value?: DocReadinessStatus;
  onChange: (v: DocReadinessStatus) => void;
  error?: string;
}) {
  return (
    <div>
      <select
        className={selectCls(error)}
        value={value || ""}
        onChange={(e) => onChange(e.target.value as DocReadinessStatus)}
      >
        <option value="">Select status…</option>
        <option value="available">Available</option>
        <option value="applied">Applied</option>
        <option value="na">N/A</option>
      </select>
      {error ? (
        <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p>
      ) : null}
    </div>
  );
}

const CONSTITUTIONS = [
  "Proprietorship",
  "Partnership",
  "LLP",
  "Private Limited Company",
  "Public Limited Company",
  "Other",
];

export type StepProps = {
  app: SupplierHubApplication;
  patch: (mutator: (draft: SupplierHubApplication) => void) => void;
  errors: FieldErrors;
  clearError: (key: string) => void;
};

export function MetaStep({ app, patch, errors, clearError }: StepProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Filled by" tip={TIP.filledBy}>
        <div className="flex gap-2">
          {(["ops", "supplier"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                app.filledBy === mode
                  ? "border-teal-700 bg-teal-50 text-teal-900"
                  : "border-zinc-200",
              )}
              onClick={() =>
                patch((d) => {
                  d.filledBy = mode;
                })
              }
            >
              {mode === "ops" ? "SNSPL ops" : "Supplier self-serve"}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Application reference" tip={TIP.reference}>
        <Input
          value={app.reference || ""}
          placeholder={PH.reference}
          onChange={(e) =>
            patch((d) => {
              d.reference = e.target.value;
            })
          }
        />
      </Field>
      <Field
        label="Prepared by"
        tip={TIP.preparedBy}
        required={app.filledBy === "ops"}
        error={errors.preparedBy}
      >
        <Input
          className={inputCls(errors.preparedBy)}
          value={app.preparedBy || ""}
          placeholder={PH.preparedBy}
          onChange={(e) => {
            clearError("preparedBy");
            patch((d) => {
              d.preparedBy = e.target.value;
            });
          }}
        />
      </Field>
      <p className="sm:col-span-2 text-xs text-zinc-500">
        Prior export experience is not required. Hover the{" "}
        <CircleHelp className="inline h-3 w-3 text-zinc-400" /> icons for field
        guidance. On submit, the factory enters the partner directory for deal
        recommendations.
      </p>
    </div>
  );
}

export function CompanyStep({ app, patch, errors, clearError }: StepProps) {
  const c = app.company;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label="Legal company / firm name"
        tip={TIP.legalName}
        required
        error={errors.legalName}
      >
        <Input
          className={inputCls(errors.legalName)}
          value={c.legalName}
          placeholder={PH.legalName}
          onChange={(e) => {
            clearError("legalName");
            patch((d) => {
              d.company.legalName = e.target.value;
            });
          }}
        />
      </Field>
      <Field label="Trade / brand name" tip={TIP.tradeName}>
        <Input
          value={c.tradeName || ""}
          placeholder={PH.tradeName}
          onChange={(e) =>
            patch((d) => {
              d.company.tradeName = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Business constitution" tip={TIP.constitution}>
        <select
          className={selectCls()}
          value={c.constitution || ""}
          onChange={(e) =>
            patch((d) => {
              d.company.constitution = e.target.value;
            })
          }
        >
          <option value="">Select constitution…</option>
          {CONSTITUTIONS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Year established"
        tip={TIP.yearEstablished}
        error={errors.yearEstablished}
      >
        <Input
          className={inputCls(errors.yearEstablished)}
          value={c.yearEstablished || ""}
          placeholder={PH.yearEstablished}
          onChange={(e) => {
            clearError("yearEstablished");
            patch((d) => {
              d.company.yearEstablished = e.target.value;
            });
          }}
        />
      </Field>
      <Field label="Registered office address" tip={TIP.registeredAddress}>
        <Textarea
          rows={2}
          value={c.registeredAddress || ""}
          placeholder={PH.registeredAddress}
          onChange={(e) =>
            patch((d) => {
              d.company.registeredAddress = e.target.value;
            })
          }
        />
      </Field>
      <Field
        label="Manufacturing facility address(es)"
        tip={TIP.manufacturingAddresses}
      >
        <Textarea
          rows={2}
          value={c.manufacturingAddresses || ""}
          placeholder={PH.manufacturingAddresses}
          onChange={(e) =>
            patch((d) => {
              d.company.manufacturingAddresses = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Number of facilities" tip={TIP.facilityCount}>
        <Input
          value={c.facilityCount || ""}
          placeholder={PH.facilityCount}
          onChange={(e) =>
            patch((d) => {
              d.company.facilityCount = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Website" tip={TIP.website} error={errors.website}>
        <Input
          className={inputCls(errors.website)}
          value={c.website || ""}
          placeholder={PH.website}
          onChange={(e) => {
            clearError("website");
            patch((d) => {
              d.company.website = e.target.value;
            });
          }}
        />
      </Field>
      <Field
        label="Primary contact"
        tip={TIP.primaryContact}
        required
        error={errors.primaryContact}
      >
        <Input
          className={inputCls(errors.primaryContact)}
          value={c.primaryContact || ""}
          placeholder={PH.primaryContact}
          onChange={(e) => {
            clearError("primaryContact");
            patch((d) => {
              d.company.primaryContact = e.target.value;
            });
          }}
        />
      </Field>
      <Field label="Designation" tip={TIP.primaryContact}>
        <Input
          value={c.designation || ""}
          placeholder={PH.designation}
          onChange={(e) =>
            patch((d) => {
              d.company.designation = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Email" tip={TIP.email} required error={errors.email}>
        <Input
          type="email"
          className={inputCls(errors.email)}
          value={c.email || ""}
          placeholder={PH.email}
          onChange={(e) => {
            clearError("email");
            clearError("phone");
            patch((d) => {
              d.company.email = e.target.value;
            });
          }}
        />
      </Field>
      <Field
        label="Phone / WhatsApp"
        tip={TIP.phone}
        required
        error={errors.phone}
      >
        <Input
          className={inputCls(errors.phone)}
          value={c.phone || ""}
          placeholder={PH.phone}
          onChange={(e) => {
            clearError("phone");
            clearError("email");
            patch((d) => {
              d.company.phone = e.target.value;
            });
          }}
        />
      </Field>
      <Field label="Turnover FY 2023–24" tip={TIP.turnover}>
        <Input
          value={c.turnoverFy2324 || ""}
          placeholder={PH.turnoverFy2324}
          onChange={(e) =>
            patch((d) => {
              d.company.turnoverFy2324 = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Turnover FY 2024–25" tip={TIP.turnover}>
        <Input
          value={c.turnoverFy2425 || ""}
          placeholder={PH.turnoverFy2425}
          onChange={(e) =>
            patch((d) => {
              d.company.turnoverFy2425 = e.target.value;
            })
          }
        />
      </Field>
      <Field
        label="Years manufacturing"
        tip={TIP.yearsManufacturing}
        error={errors.yearsManufacturing}
      >
        <Input
          className={inputCls(errors.yearsManufacturing)}
          value={c.yearsManufacturing || ""}
          placeholder={PH.yearsManufacturing}
          onChange={(e) => {
            clearError("yearsManufacturing");
            patch((d) => {
              d.company.yearsManufacturing = e.target.value;
            });
          }}
        />
      </Field>
      <Field
        label="Years in proposed category"
        tip={TIP.yearsInCategory}
        error={errors.yearsInCategory}
      >
        <Input
          className={inputCls(errors.yearsInCategory)}
          value={c.yearsInCategory || ""}
          placeholder={PH.yearsInCategory}
          onChange={(e) => {
            clearError("yearsInCategory");
            patch((d) => {
              d.company.yearsInCategory = e.target.value;
            });
          }}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Major domestic markets / segments" tip={TIP.domesticMarkets}>
          <Textarea
            rows={2}
            value={c.domesticMarkets || ""}
            placeholder={PH.domesticMarkets}
            onChange={(e) =>
              patch((d) => {
                d.company.domesticMarkets = e.target.value;
              })
            }
          />
        </Field>
      </div>
    </div>
  );
}

export function InfrastructureStep({
  app,
  patch,
  errors,
  clearError,
}: StepProps) {
  const i = app.infrastructure;
  const area = (
    key:
      | "totalPremisesSqft"
      | "builtUpSqft"
      | "productionSqft"
      | "rmStorageSqft"
      | "wipStorageSqft"
      | "fgWarehouseSqft"
      | "packingSqft"
      | "qcSqft"
      | "labSqft"
      | "dispatchSqft",
    label: string,
  ) => (
    <Field
      label={label}
      tip={TIP.sqft}
      required={key === "productionSqft"}
      error={errors[key]}
    >
      <Input
        className={inputCls(errors[key])}
        value={(i[key] as string) || ""}
        placeholder={PH[key]}
        onChange={(e) => {
          clearError(key);
          clearError("productionSqft");
          patch((d) => {
            (d.infrastructure as Record<string, unknown>)[key] = e.target.value;
          });
        }}
      />
    </Field>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {area("totalPremisesSqft", "Total premises (sq. ft.)")}
        {area("builtUpSqft", "Built-up area")}
        {area("productionSqft", "Production / shop-floor")}
        {area("rmStorageSqft", "Raw-material storage")}
        {area("wipStorageSqft", "WIP storage")}
        {area("fgWarehouseSqft", "Finished-goods warehouse")}
        {area("packingSqft", "Packing area")}
        {area("qcSqft", "QC area")}
        {area("labSqft", "Testing lab")}
        {area("dispatchSqft", "Dispatch / loading")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Ownership / lease" tip={TIP.ownershipStatus}>
          <Input
            value={i.ownershipStatus || ""}
            placeholder={PH.ownershipStatus}
            onChange={(e) =>
              patch((d) => {
                d.infrastructure.ownershipStatus = e.target.value;
              })
            }
          />
        </Field>
        <Field label="Shifts / day" tip={TIP.sqft} error={errors.shiftsPerDay}>
          <Input
            className={inputCls(errors.shiftsPerDay)}
            value={i.shiftsPerDay || ""}
            placeholder={PH.shiftsPerDay}
            onChange={(e) => {
              clearError("shiftsPerDay");
              patch((d) => {
                d.infrastructure.shiftsPerDay = e.target.value;
              });
            }}
          />
        </Field>
        <Field
          label="Utilisation %"
          tip={TIP.utilisationPct}
          error={errors.utilisationPct}
        >
          <Input
            className={inputCls(errors.utilisationPct)}
            value={i.utilisationPct || ""}
            placeholder={PH.utilisationPct}
            onChange={(e) => {
              clearError("utilisationPct");
              patch((d) => {
                d.infrastructure.utilisationPct = e.target.value;
              });
            }}
          />
        </Field>
        <Field
          label="Spare capacity %"
          tip={TIP.spareCapacityPct}
          error={errors.spareCapacityPct}
        >
          <Input
            className={inputCls(errors.spareCapacityPct)}
            value={i.spareCapacityPct || ""}
            placeholder={PH.spareCapacityPct}
            onChange={(e) => {
              clearError("spareCapacityPct");
              patch((d) => {
                d.infrastructure.spareCapacityPct = e.target.value;
              });
            }}
          />
        </Field>
      </div>
      <Field label="Dedicated / controlled areas" tip={TIP.dedicatedAreas}>
        <CheckGroup
          options={[
            "Rejected / non-conforming material",
            "Finished goods quarantine",
            "Sample storage",
            "Export packing / staging",
            "Other",
          ]}
          value={i.dedicatedAreas}
          onChange={(next) =>
            patch((d) => {
              d.infrastructure.dedicatedAreas = next;
            })
          }
        />
      </Field>
    </div>
  );
}

export function CapacityStep({ app, patch, errors, clearError }: StepProps) {
  const c = app.capacity;
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-600">
          Principal machines
          <Tip text={TIP.machines} />
          <span className="text-red-600">*</span>
        </div>
        {errors.machines ? (
          <p className="mb-2 text-[11px] font-medium text-red-600">
            {errors.machines}
          </p>
        ) : null}
        <div className="space-y-2">
          {c.machines.map((m, idx) => (
            <div key={idx} className="grid gap-2 sm:grid-cols-5">
              <Input
                className={inputCls(errors.machines)}
                placeholder={PH.machineName}
                value={m.name}
                onChange={(e) => {
                  clearError("machines");
                  patch((d) => {
                    d.capacity.machines[idx]!.name = e.target.value;
                  });
                }}
              />
              <Input
                className={inputCls(errors[`machineQty-${idx}`])}
                placeholder={PH.machineQty}
                value={m.qty || ""}
                onChange={(e) => {
                  clearError(`machineQty-${idx}`);
                  patch((d) => {
                    d.capacity.machines[idx]!.qty = e.target.value;
                  });
                }}
              />
              <Input
                placeholder={PH.machineCapacity}
                value={m.capacity || ""}
                onChange={(e) =>
                  patch((d) => {
                    d.capacity.machines[idx]!.capacity = e.target.value;
                  })
                }
              />
              <Input
                placeholder={PH.machineMake}
                value={m.makeModel || ""}
                onChange={(e) =>
                  patch((d) => {
                    d.capacity.machines[idx]!.makeModel = e.target.value;
                  })
                }
              />
              <Input
                className={inputCls(errors[`machineYear-${idx}`])}
                placeholder={PH.machineYear}
                value={m.year || ""}
                onChange={(e) => {
                  clearError(`machineYear-${idx}`);
                  patch((d) => {
                    d.capacity.machines[idx]!.year = e.target.value;
                  });
                }}
              />
            </div>
          ))}
          <Button
            variant="secondary"
            type="button"
            onClick={() =>
              patch((d) => {
                d.capacity.machines.push({ name: "" });
              })
            }
          >
            Add machine
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Production lines" tip={TIP.productionLines}>
          <Input
            value={c.productionLines || ""}
            placeholder={PH.productionLines}
            onChange={(e) =>
              patch((d) => {
                d.capacity.productionLines = e.target.value;
              })
            }
          />
        </Field>
        <Field label="Daily / weekly / monthly output" tip={TIP.output}>
          <Input
            value={c.outputDailyWeeklyMonthly || ""}
            placeholder={PH.outputDailyWeeklyMonthly}
            onChange={(e) =>
              patch((d) => {
                d.capacity.outputDailyWeeklyMonthly = e.target.value;
              })
            }
          />
        </Field>
        <Field label="Max achievable capacity" tip={TIP.output}>
          <Input
            value={c.maxCapacity || ""}
            placeholder={PH.maxCapacity}
            onChange={(e) =>
              patch((d) => {
                d.capacity.maxCapacity = e.target.value;
              })
            }
          />
        </Field>
        <Field
          label="Capacity utilisation %"
          tip={TIP.utilisationPct}
          error={errors.capacityUtilisationPct}
        >
          <Input
            className={inputCls(errors.capacityUtilisationPct)}
            value={c.capacityUtilisationPct || ""}
            placeholder={PH.capacityUtilisationPct}
            onChange={(e) => {
              clearError("capacityUtilisationPct");
              patch((d) => {
                d.capacity.capacityUtilisationPct = e.target.value;
              });
            }}
          />
        </Field>
        <Field
          label="Normal production lead time"
          tip={TIP.normalLeadTime}
          required
          error={errors.normalLeadTime}
        >
          <Input
            className={inputCls(errors.normalLeadTime)}
            value={c.normalLeadTime || ""}
            placeholder={PH.normalLeadTime}
            onChange={(e) => {
              clearError("normalLeadTime");
              patch((d) => {
                d.capacity.normalLeadTime = e.target.value;
              });
            }}
          />
        </Field>
        <Field
          label="Sample lead — existing"
          tip={TIP.sampleLead}
          error={errors.sampleLeadExisting}
        >
          <Input
            className={inputCls(errors.sampleLeadExisting)}
            value={c.sampleLeadExisting || ""}
            placeholder={PH.sampleLeadExisting}
            onChange={(e) => {
              clearError("sampleLeadExisting");
              patch((d) => {
                d.capacity.sampleLeadExisting = e.target.value;
              });
            }}
          />
        </Field>
        <Field
          label="Sample lead — new development"
          tip={TIP.sampleLead}
          error={errors.sampleLeadNew}
        >
          <Input
            className={inputCls(errors.sampleLeadNew)}
            value={c.sampleLeadNew || ""}
            placeholder={PH.sampleLeadNew}
            onChange={(e) => {
              clearError("sampleLeadNew");
              patch((d) => {
                d.capacity.sampleLeadNew = e.target.value;
              });
            }}
          />
        </Field>
        <Field label="Planned expansion">
          <Input
            value={c.plannedExpansion || ""}
            placeholder={PH.plannedExpansion}
            onChange={(e) =>
              patch((d) => {
                d.capacity.plannedExpansion = e.target.value;
              })
            }
          />
        </Field>
      </div>
    </div>
  );
}

export function WorkforceStep({ app, patch, errors, clearError }: StepProps) {
  const w = app.workforce;
  const row = (
    key:
      | "permanentProduction"
      | "permanentQuality"
      | "packingWarehouse"
      | "maintenance"
      | "supervisory"
      | "temporary"
      | "avgPresentDay",
    label: string,
    required?: boolean,
  ) => (
    <Field
      label={label}
      tip={TIP.workforce}
      required={required}
      error={errors[key]}
    >
      <Input
        className={inputCls(errors[key])}
        value={(w[key] as string) || ""}
        placeholder={PH[key]}
        onChange={(e) => {
          clearError(key);
          clearError("permanentProduction");
          patch((d) => {
            (d.workforce as Record<string, unknown>)[key] = e.target.value;
          });
        }}
      />
    </Field>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {row("permanentProduction", "Permanent production", true)}
      {row("permanentQuality", "Permanent quality / technical")}
      {row("packingWarehouse", "Packing / warehouse")}
      {row("maintenance", "Maintenance / engineering")}
      {row("supervisory", "Supervisory / management")}
      {row("temporary", "Temporary / contract")}
      {row("avgPresentDay", "Avg present on production day")}
      <Field label="Temp labour dependency" tip={TIP.tempLabour}>
        <select
          className={selectCls()}
          value={w.tempLabourDependency || ""}
          onChange={(e) =>
            patch((d) => {
              d.workforce.tempLabourDependency = e.target.value;
            })
          }
        >
          <option value="">Select…</option>
          <option value="No">No</option>
          <option value="Partially">Partially</option>
          <option value="Significantly">Significantly</option>
        </select>
      </Field>
      <div className="sm:col-span-2 lg:col-span-3">
        <Field label="Key production / QC personnel" tip={TIP.workforce}>
          <Textarea
            rows={2}
            value={w.keyPersonnel || ""}
            placeholder={PH.keyPersonnel}
            onChange={(e) =>
              patch((d) => {
                d.workforce.keyPersonnel = e.target.value;
              })
            }
          />
        </Field>
      </div>
    </div>
  );
}

export function ProductsStep({ app, patch, errors, clearError }: StepProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Product categories and materials drive factory↔deal matching.
      </p>
      {errors.products ? (
        <p className="text-[11px] font-medium text-red-600">{errors.products}</p>
      ) : null}
      {app.products.families.map((f, idx) => (
        <div
          key={idx}
          className="space-y-3 rounded-lg border border-zinc-100 p-3"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Product family {idx + 1}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Name"
              required
              error={errors[`productName-${idx}`]}
            >
              <Input
                className={inputCls(errors[`productName-${idx}`] || errors.products)}
                value={f.name}
                placeholder={PH.productName}
                onChange={(e) => {
                  clearError("products");
                  clearError(`productName-${idx}`);
                  patch((d) => {
                    d.products.families[idx]!.name = e.target.value;
                  });
                }}
              />
            </Field>
            <Field
              label="Category"
              tip={TIP.productCategory}
              required
              error={errors[`productCategory-${idx}`]}
            >
              <Input
                className={inputCls(
                  errors[`productCategory-${idx}`] || errors.products,
                )}
                value={f.category}
                placeholder={PH.productCategory}
                onChange={(e) => {
                  clearError("products");
                  clearError(`productCategory-${idx}`);
                  patch((d) => {
                    d.products.families[idx]!.category = e.target.value;
                  });
                }}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Commercial description">
                <Textarea
                  rows={2}
                  value={f.description || ""}
                  placeholder={PH.productDescription}
                  onChange={(e) =>
                    patch((d) => {
                      d.products.families[idx]!.description = e.target.value;
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Materials / composition" tip={TIP.materials}>
              <Input
                value={f.materials || ""}
                placeholder={PH.productMaterials}
                onChange={(e) =>
                  patch((d) => {
                    d.products.families[idx]!.materials = e.target.value;
                  })
                }
              />
            </Field>
            <Field label="Sizes / variants">
              <Input
                value={f.sizesVariants || ""}
                placeholder={PH.productSizes}
                onChange={(e) =>
                  patch((d) => {
                    d.products.families[idx]!.sizesVariants = e.target.value;
                  })
                }
              />
            </Field>
            <Field label="SKU / model code">
              <Input
                value={f.skuCode || ""}
                placeholder={PH.productSku}
                onChange={(e) =>
                  patch((d) => {
                    d.products.families[idx]!.skuCode = e.target.value;
                  })
                }
              />
            </Field>
            <Field label="HSN / HS code" tip={TIP.hsn}>
              <Input
                value={f.hsnCode || ""}
                placeholder={PH.productHsn}
                onChange={(e) =>
                  patch((d) => {
                    d.products.families[idx]!.hsnCode = e.target.value;
                  })
                }
              />
            </Field>
          </div>
          <Field label="Product info available" tip={TIP.productInfo}>
            <CheckGroup
              options={[
                "Product specification sheet",
                "Technical data sheet",
                "Ingredients / composition sheet",
                "Product photographs",
                "Catalogue",
                "Artwork / labelling",
                "Test reports",
                "COA",
              ]}
              value={f.infoAvailable}
              onChange={(next) =>
                patch((d) => {
                  d.products.families[idx]!.infoAvailable = next;
                })
              }
            />
          </Field>
        </div>
      ))}
      <Button
        variant="secondary"
        type="button"
        onClick={() =>
          patch((d) => {
            d.products.families.push({ name: "", category: "" });
          })
        }
      >
        Add product family
      </Button>
    </div>
  );
}

export function PackagingStep({ app, patch, errors, clearError }: StepProps) {
  const p = app.packaging;
  return (
    <div className="space-y-4">
      <Field
        label="Product form"
        tip={TIP.packagingForm}
        required
        error={errors.productForm}
      >
        <CheckGroup
          error={errors.productForm}
          options={[
            "Finished product with standard packaging",
            "Finished product; buyer-specific packaging",
            "Semi-finished / component",
            "Bulk product / other",
          ]}
          value={p.productForm ? [p.productForm] : []}
          onChange={(next) => {
            clearError("productForm");
            patch((d) => {
              d.packaging.productForm = next[next.length - 1] || "";
            });
          }}
        />
      </Field>
      <Field label="Standard retail / inner / master format">
        <Textarea
          rows={2}
          value={p.standardPackFormat || ""}
          placeholder={PH.standardPackFormat}
          onChange={(e) =>
            patch((d) => {
              d.packaging.standardPackFormat = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Export packing information available" tip={TIP.exportPackInfo}>
        <CheckGroup
          options={[
            "Units per inner pack",
            "Units per master case",
            "Master-case dimensions",
            "Gross weight per master case",
            "Net weight per master case",
            "CBM per master case",
            "Pallet configuration",
            "Container-loading information",
          ]}
          value={p.exportPackInfo}
          onChange={(next) =>
            patch((d) => {
              d.packaging.exportPackInfo = next;
            })
          }
        />
      </Field>
      <Field label="Master case qty / dimensions / CBM" tip={TIP.exportPackInfo}>
        <Input
          value={p.masterCaseDetails || ""}
          placeholder={PH.masterCaseDetails}
          onChange={(e) =>
            patch((d) => {
              d.packaging.masterCaseDetails = e.target.value;
            })
          }
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Custom packaging / labelling?" tip={TIP.customPackaging}>
          <select
            className={selectCls()}
            value={p.customPackaging || ""}
            onChange={(e) =>
              patch((d) => {
                d.packaging.customPackaging = e.target.value;
              })
            }
          >
            <option value="">Select…</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="Subject to MOQ">Subject to MOQ</option>
          </select>
        </Field>
        <Field label="Export-quality packing materials?">
          <select
            className={selectCls()}
            value={p.exportPackMaterials || ""}
            onChange={(e) =>
              patch((d) => {
                d.packaging.exportPackMaterials = e.target.value;
              })
            }
          >
            <option value="">Select…</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="Subject to specification">
              Subject to specification
            </option>
          </select>
        </Field>
      </div>
    </div>
  );
}

export function QualityStep({ app, patch, errors, clearError }: StepProps) {
  const q = app.quality;
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-600">
          Certifications / audits
          <Tip text={TIP.certifications} />
        </div>
        {q.certifications.map((c, idx) => (
          <div key={idx} className="mb-2 grid gap-2 sm:grid-cols-4">
            <Input
              placeholder="e.g. ISO 9001 / Amfori BSCI"
              value={c.name}
              onChange={(e) =>
                patch((d) => {
                  d.quality.certifications[idx]!.name = e.target.value;
                })
              }
            />
            <Input
              placeholder="Issuer — e.g. SGS"
              value={c.issuer || ""}
              onChange={(e) =>
                patch((d) => {
                  d.quality.certifications[idx]!.issuer = e.target.value;
                })
              }
            />
            <Input
              placeholder="Validity — e.g. Mar 2027"
              value={c.validity || ""}
              onChange={(e) =>
                patch((d) => {
                  d.quality.certifications[idx]!.validity = e.target.value;
                })
              }
            />
            <Input
              placeholder="Scope — e.g. whole facility"
              value={c.scope || ""}
              onChange={(e) =>
                patch((d) => {
                  d.quality.certifications[idx]!.scope = e.target.value;
                })
              }
            />
          </div>
        ))}
        <Button
          variant="secondary"
          type="button"
          onClick={() =>
            patch((d) => {
              d.quality.certifications.push({ name: "" });
            })
          }
        >
          Add certification
        </Button>
      </div>
      <Field label="Quality / testing capability" tip={TIP.qcCapabilities}>
        <CheckGroup
          options={[
            "In-house QC team",
            "In-house laboratory",
            "Third-party laboratory",
            "Incoming raw-material testing",
            "In-process inspection",
            "Finished-product testing",
            "Retention samples",
            "Traceability system",
          ]}
          value={q.qcCapabilities}
          onChange={(next) =>
            patch((d) => {
              d.quality.qcCapabilities = next;
            })
          }
        />
      </Field>
      <Field label="Previous factory audits">
        <Textarea
          rows={2}
          value={q.previousAudits || ""}
          placeholder={PH.previousAudits}
          onChange={(e) =>
            patch((d) => {
              d.quality.previousAudits = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Most recent audit outcome">
        <Input
          value={q.recentAuditOutcome || ""}
          placeholder={PH.recentAuditOutcome}
          onChange={(e) =>
            patch((d) => {
              d.quality.recentAuditOutcome = e.target.value;
            })
          }
        />
      </Field>
      <Field
        label="Willingness to undergo factory audit"
        tip={TIP.auditWillingness}
        required
        error={errors.auditWillingness}
      >
        <select
          className={selectCls(errors.auditWillingness)}
          value={q.auditWillingness || ""}
          onChange={(e) => {
            clearError("auditWillingness");
            patch((d) => {
              d.quality.auditWillingness = e.target.value;
            });
          }}
        >
          <option value="">Select…</option>
          <option value="Yes — at our cost">Yes — at our cost</option>
          <option value="Yes — subject to discussion">
            Yes — subject to discussion
          </option>
          <option value="Only if buyer bears cost">
            Only if buyer bears cost
          </option>
          <option value="No">No</option>
        </select>
      </Field>
    </div>
  );
}

export function MarketStep({ app, patch, errors, clearError }: StepProps) {
  const m = app.market;
  return (
    <div className="space-y-4">
      <Field
        label="Where products are currently supplied"
        tip={TIP.supplyMarkets}
        required
        error={errors.supplyMarkets}
      >
        <CheckGroup
          error={errors.supplyMarkets}
          options={[
            "Domestic market only",
            "Domestic + export markets",
            "Primarily export markets",
            "Supplied to party whose goods are exported",
          ]}
          value={m.supplyMarkets}
          onChange={(next) => {
            clearError("supplyMarkets");
            patch((d) => {
              d.market.supplyMarkets = next;
            });
          }}
        />
      </Field>
      <Field label="If products reach export markets, how?" tip={TIP.exportPath}>
        <CheckGroup
          options={[
            "Direct exports under our IEC",
            "Through merchant exporter",
            "Job work / contract manufacturing",
            "OEM / private label for exporter",
            "Supplied to another manufacturer",
            "Related / group company",
            "Other",
          ]}
          value={m.exportPath}
          onChange={(next) =>
            patch((d) => {
              d.market.exportPath = next;
            })
          }
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Years of direct export (0 if none)"
          tip={TIP.yearsDirectExport}
          error={errors.yearsDirectExport}
        >
          <Input
            className={inputCls(errors.yearsDirectExport)}
            value={m.yearsDirectExport || ""}
            placeholder={PH.yearsDirectExport}
            onChange={(e) => {
              clearError("yearsDirectExport");
              patch((d) => {
                d.market.yearsDirectExport = e.target.value;
              });
            }}
          />
        </Field>
        <Field label="Annual export turnover">
          <Input
            value={m.annualExportTurnover || ""}
            placeholder={PH.annualExportTurnover}
            onChange={(e) =>
              patch((d) => {
                d.market.annualExportTurnover = e.target.value;
              })
            }
          />
        </Field>
        <Field label="Direct export countries">
          <Input
            value={m.exportCountries || ""}
            placeholder={PH.exportCountries}
            onChange={(e) =>
              patch((d) => {
                d.market.exportCountries = e.target.value;
              })
            }
          />
        </Field>
        <Field label="Years indirect export supply">
          <Input
            value={m.yearsIndirectExport || ""}
            placeholder={PH.yearsIndirectExport}
            onChange={(e) =>
              patch((d) => {
                d.market.yearsIndirectExport = e.target.value;
              })
            }
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Categories supplied for export">
            <Input
              value={m.exportCategories || ""}
              placeholder={PH.exportCategories}
              onChange={(e) =>
                patch((d) => {
                  d.market.exportCategories = e.target.value;
                })
              }
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

export function ExportDocsStep({ app, patch, errors, clearError }: StepProps) {
  const d = app.exportDocs;
  const rows: Array<{
    key: keyof typeof d;
    refKey: keyof typeof d;
    label: string;
    required?: boolean;
  }> = [
    { key: "pan", refKey: "panRef", label: "PAN", required: true },
    { key: "gst", refKey: "gstRef", label: "GST", required: true },
    { key: "lut", refKey: "lutRef", label: "LUT" },
    { key: "iec", refKey: "iecRef", label: "IEC", required: true },
    { key: "icegate", refKey: "icegateRef", label: "ICEGATE" },
    { key: "adCode", refKey: "adCodeRef", label: "AD Code" },
    { key: "rcmc", refKey: "rcmcRef", label: "RCMC" },
    { key: "entityDoc", refKey: "entityDocRef", label: "Entity document" },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">{TIP.exportDocs}</p>
      {rows.map((r) => (
        <div key={String(r.key)} className="grid gap-2 sm:grid-cols-3">
          <div className="flex items-center gap-1 text-sm text-zinc-700">
            {r.label}
            {r.required ? <span className="text-red-600">*</span> : null}
            <Tip text={TIP.exportDocs} />
          </div>
          <DocStatusSelect
            value={d[r.key] as DocReadinessStatus}
            error={errors[String(r.key)]}
            onChange={(v) => {
              clearError(String(r.key));
              patch((draft) => {
                (draft.exportDocs as Record<string, unknown>)[r.key] = v;
              });
            }}
          />
          <Input
            placeholder={PH.docRef}
            title={TIP.docRef}
            value={(d[r.refKey] as string) || ""}
            onChange={(e) =>
              patch((draft) => {
                (draft.exportDocs as Record<string, unknown>)[r.refKey] =
                  e.target.value;
              })
            }
          />
        </div>
      ))}
      <Field label="Product-specific licences">
        <Textarea
          rows={2}
          value={d.productLicences || ""}
          placeholder={PH.productLicences}
          onChange={(e) =>
            patch((draft) => {
              draft.exportDocs.productLicences = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Ports / ICDs previously used">
        <Input
          value={d.portsUsed || ""}
          placeholder={PH.portsUsed}
          onChange={(e) =>
            patch((draft) => {
              draft.exportDocs.portsUsed = e.target.value;
            })
          }
        />
      </Field>
    </div>
  );
}

export function BuyerSupportStep({
  app,
  patch,
  errors,
  clearError,
}: StepProps) {
  const b = app.buyerSupport;
  return (
    <div className="space-y-4">
      <Field
        label="Can respond to"
        tip={TIP.buyerRespond}
        required
        error={errors.canRespondTo}
      >
        <CheckGroup
          error={errors.canRespondTo}
          options={[
            "Product specification queries",
            "Price / quotation requests",
            "MOQ",
            "Capacity / lead time",
            "Packaging / labelling queries",
            "Quality / testing queries",
            "Buyer questionnaires",
            "Factory audit questionnaires",
            "Corrective-action requests",
          ]}
          value={b.canRespondTo}
          onChange={(next) => {
            clearError("canRespondTo");
            patch((d) => {
              d.buyerSupport.canRespondTo = next;
            });
          }}
        />
      </Field>
      <Field label="Sampling capability" tip={TIP.sampling}>
        <CheckGroup
          options={[
            "Existing-product samples",
            "Product modifications",
            "New product development",
            "Samples within agreed timelines",
            "Sample packaging / labels",
            "Sample documentation",
          ]}
          value={b.samplingCapability}
          onChange={(next) =>
            patch((d) => {
              d.buyerSupport.samplingCapability = next;
            })
          }
        />
      </Field>
      <Field label="Overseas sample support" tip={TIP.overseasSample}>
        <CheckGroup
          options={[
            "Send samples to overseas buyers",
            "Arrange courier shipment",
            "Bear sample cost",
            "Bear / share courier cost",
            "Subject to buyer / order potential",
            "Not currently able to support",
          ]}
          value={b.overseasSampleSupport}
          onChange={(next) =>
            patch((d) => {
              d.buyerSupport.overseasSampleSupport = next;
            })
          }
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Typical sample development lead time" tip={TIP.sampleLead}>
          <Input
            value={b.sampleLeadTime || ""}
            placeholder={PH.sampleLeadTime}
            onChange={(e) =>
              patch((d) => {
                d.buyerSupport.sampleLeadTime = e.target.value;
              })
            }
          />
        </Field>
        <Field label="Intl buyer query owner">
          <Input
            value={b.intlQueryOwner || ""}
            placeholder={PH.intlQueryOwner}
            onChange={(e) =>
              patch((d) => {
                d.buyerSupport.intlQueryOwner = e.target.value;
              })
            }
          />
        </Field>
        <Field
          label="English commercial / technical communication"
          tip={TIP.english}
          required
          error={errors.englishCommunication}
        >
          <select
            className={selectCls(errors.englishCommunication)}
            value={b.englishCommunication || ""}
            onChange={(e) => {
              clearError("englishCommunication");
              patch((d) => {
                d.buyerSupport.englishCommunication = e.target.value;
              });
            }}
          >
            <option value="">Select…</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="With assistance">With assistance</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

export function CommercialStep({ app, patch, errors, clearError }: StepProps) {
  const c = app.commercial;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Standard MOQ" tip={TIP.moq} required error={errors.moq}>
          <Input
            className={inputCls(errors.moq)}
            value={c.moq || ""}
            placeholder={PH.moq}
            onChange={(e) => {
              clearError("moq");
              patch((d) => {
                d.commercial.moq = e.target.value;
              });
            }}
          />
        </Field>
        <Field label="MOV" tip={TIP.mov}>
          <Input
            value={c.mov || ""}
            placeholder={PH.mov}
            onChange={(e) =>
              patch((d) => {
                d.commercial.mov = e.target.value;
              })
            }
          />
        </Field>
        <Field
          label="Repeat-order lead time"
          tip={TIP.normalLeadTime}
          error={errors.repeatLeadTime}
        >
          <Input
            className={inputCls(errors.repeatLeadTime)}
            value={c.repeatLeadTime || ""}
            placeholder={PH.repeatLeadTime}
            onChange={(e) => {
              clearError("repeatLeadTime");
              patch((d) => {
                d.commercial.repeatLeadTime = e.target.value;
              });
            }}
          />
        </Field>
        <Field
          label="First / customised-order lead time"
          error={errors.firstOrderLeadTime}
        >
          <Input
            className={inputCls(errors.firstOrderLeadTime)}
            value={c.firstOrderLeadTime || ""}
            placeholder={PH.firstOrderLeadTime}
            onChange={(e) => {
              clearError("firstOrderLeadTime");
              patch((d) => {
                d.commercial.firstOrderLeadTime = e.target.value;
              });
            }}
          />
        </Field>
        <Field
          label="Payment terms normally accepted"
          tip={TIP.paymentTerms}
          required
          error={errors.paymentTerms}
        >
          <Input
            className={inputCls(errors.paymentTerms)}
            value={c.paymentTerms || ""}
            placeholder={PH.paymentTerms}
            onChange={(e) => {
              clearError("paymentTerms");
              patch((d) => {
                d.commercial.paymentTerms = e.target.value;
              });
            }}
          />
        </Field>
        <Field label="Preferred payment / currency">
          <Input
            value={c.preferredPaymentMethod || ""}
            placeholder={PH.preferredPaymentMethod}
            onChange={(e) =>
              patch((d) => {
                d.commercial.preferredPaymentMethod = e.target.value;
              })
            }
          />
        </Field>
        <Field label="Incoterms previously used" tip={TIP.incoterms}>
          <Input
            value={c.incoterms || ""}
            placeholder={PH.incoterms}
            onChange={(e) =>
              patch((d) => {
                d.commercial.incoterms = e.target.value;
              })
            }
          />
        </Field>
        <Field label="Export gateway / port / ICD" tip={TIP.exportGateway}>
          <Input
            value={c.exportGateway || ""}
            placeholder={PH.exportGateway}
            onChange={(e) =>
              patch((d) => {
                d.commercial.exportGateway = e.target.value;
              })
            }
          />
        </Field>
      </div>
      <Field label="Order types supported" tip={TIP.orderTypes}>
        <CheckGroup
          options={[
            "Trial orders",
            "Small initial orders",
            "Large-volume orders",
            "Regular repeat programmes",
            "Seasonal programmes",
            "OEM / private label",
            "Buyer-specific packaging",
            "Buyer-specific specifications",
          ]}
          value={c.orderTypes}
          onChange={(next) =>
            patch((d) => {
              d.commercial.orderTypes = next;
            })
          }
        />
      </Field>
      <Field
        label="Commercial constraints before buyer introduction"
        tip={TIP.commercialConstraints}
      >
        <Textarea
          rows={2}
          value={c.commercialConstraints || ""}
          placeholder={PH.commercialConstraints}
          onChange={(e) =>
            patch((d) => {
              d.commercial.commercialConstraints = e.target.value;
            })
          }
        />
      </Field>
    </div>
  );
}

export function AssessmentStep({
  app,
  patch,
  errors,
  clearError,
  onRefresh,
}: StepProps & { onRefresh: () => void }) {
  const a = app.assessment;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-zinc-500">
          {TIP.assessment}
          <Tip text={TIP.assessment} />
        </p>
        <Button variant="secondary" type="button" onClick={onRefresh}>
          Re-suggest scores
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-500">
              <th className="py-2 pr-2 font-medium">Dimension</th>
              <th className="py-2 pr-2 font-medium">Weight</th>
              <th className="py-2 pr-2 font-medium">Score</th>
              <th className="py-2 font-medium">Evidence / gap</th>
            </tr>
          </thead>
          <tbody>
            {a.dimensions.map((dim, idx) => (
              <tr key={dim.id} className="border-b border-zinc-50 align-top">
                <td className="py-2 pr-2 text-zinc-800">{dim.label}</td>
                <td className="py-2 pr-2 text-zinc-500">{dim.weightPct}%</td>
                <td className="py-2 pr-2">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className={cn("w-20", inputCls(errors[`dimScore-${idx}`]))}
                    value={dim.score}
                    onChange={(e) => {
                      clearError(`dimScore-${idx}`);
                      patch((d) => {
                        const score = Number(e.target.value) || 0;
                        d.assessment.dimensions[idx]!.score = score;
                        d.assessment.totalScore = recomputeAssessmentTotal(
                          d.assessment.dimensions,
                        );
                        d.assessment.classification = classifyReadiness(
                          d.assessment.totalScore,
                        );
                        d.assessment.autoSuggested = false;
                      });
                    }}
                  />
                  {errors[`dimScore-${idx}`] ? (
                    <p className="mt-1 text-[10px] text-red-600">
                      {errors[`dimScore-${idx}`]}
                    </p>
                  ) : null}
                </td>
                <td className="py-2">
                  <Input
                    value={dim.evidence || ""}
                    placeholder={PH.evidence}
                    onChange={(e) =>
                      patch((d) => {
                        d.assessment.dimensions[idx]!.evidence = e.target.value;
                        d.assessment.autoSuggested = false;
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 rounded-lg border border-zinc-100 bg-zinc-50/80 p-3 sm:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Total</div>
          <div className="font-mono text-xl font-semibold">
            {a.totalScore}
            <span className="text-sm font-normal text-zinc-500"> / 100</span>
          </div>
        </div>
        <div className="sm:col-span-2">
          <Field
            label="Classification"
            tip={TIP.assessment}
            required
            error={errors.classification}
          >
            <select
              className={selectCls(errors.classification)}
              value={a.classification || ""}
              onChange={(e) => {
                clearError("classification");
                patch((d) => {
                  d.assessment.classification = e.target
                    .value as ExportReadinessClass | "";
                  d.assessment.autoSuggested = false;
                });
              }}
            >
              <option value="">Select classification…</option>
              {(
                [
                  "export_ready",
                  "export_ready_with_conditions",
                  "partially_export_ready",
                  "not_currently_export_ready",
                ] as ExportReadinessClass[]
              ).map((c) => (
                <option key={c} value={c}>
                  {readinessClassLabel(c)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <Field label="Critical gaps / conditions">
        <Textarea
          rows={2}
          value={a.criticalGaps || ""}
          placeholder={PH.criticalGaps}
          onChange={(e) =>
            patch((d) => {
              d.assessment.criticalGaps = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Key strengths">
        <Textarea
          rows={2}
          value={a.keyStrengths || ""}
          placeholder={PH.keyStrengths}
          onChange={(e) =>
            patch((d) => {
              d.assessment.keyStrengths = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Recommended next steps">
        <Textarea
          rows={2}
          value={a.recommendedNextSteps || ""}
          placeholder={PH.recommendedNextSteps}
          onChange={(e) =>
            patch((d) => {
              d.assessment.recommendedNextSteps = e.target.value;
            })
          }
        />
      </Field>

      <div className="rounded-lg border border-teal-100 bg-teal-50/40 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-teal-900">
          Manufacturer declaration
          <Tip text={TIP.declaration} />
        </div>
        <label className="flex items-start gap-2 text-sm text-zinc-800">
          <input
            type="checkbox"
            className="mt-1"
            checked={app.declaration.confirmed}
            onChange={(e) => {
              clearError("declaration");
              patch((d) => {
                d.declaration.confirmed = e.target.checked;
              });
            }}
          />
          <span>
            I confirm the information is accurate to the best of my knowledge.
            Inclusion in the Suppliers HUB does not guarantee an order.
          </span>
        </label>
        {errors.declaration ? (
          <p className="mt-1 text-[11px] font-medium text-red-600">
            {errors.declaration}
          </p>
        ) : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            label="Authorised person name"
            tip={TIP.declaration}
            required
            error={errors.authorisedName}
          >
            <Input
              className={inputCls(errors.authorisedName)}
              value={app.declaration.authorisedName || ""}
              placeholder={PH.authorisedName}
              onChange={(e) => {
                clearError("authorisedName");
                patch((d) => {
                  d.declaration.authorisedName = e.target.value;
                });
              }}
            />
          </Field>
          <Field label="Designation">
            <Input
              value={app.declaration.designation || ""}
              placeholder={PH.declarationDesignation}
              onChange={(e) =>
                patch((d) => {
                  d.declaration.designation = e.target.value;
                })
              }
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
