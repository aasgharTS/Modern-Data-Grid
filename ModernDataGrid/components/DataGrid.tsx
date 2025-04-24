import React, { Component } from 'react';
import { FilterMatchMode, FilterOperator } from 'primereact/api';
import { DataTable, DataTableStateEvent } from 'primereact/datatable';
import isEqual from 'lodash.isequal';
import { Column } from 'primereact/column';
import { InputText } from 'primereact/inputtext';
import { IconField } from 'primereact/iconfield';
import { InputIcon } from 'primereact/inputicon';
import { IInputs } from "../generated/ManifestTypes";
import { formatDate, getAvailableDatePatterns } from '../helpers/Utils';
import 'primereact/resources/themes/saga-blue/theme.css';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';
import 'primeflex/primeflex.css';
import "./DataGrid.css";

interface DataGridProps {
    context: ComponentFramework.Context<IInputs>;
    notifyOutputChanged: () => void;
}

interface DataGridState {
    records: any[];
    selectedRecordIds: any[];
    selectedRecords: any[];
    filters: any;
    globalFilterValue: string;
    columns: ComponentFramework.PropertyHelper.DataSetApi.Column[];
    previousParameters: { [key in keyof IInputs]?: any };
    enabled: boolean;
    needsRefresh: boolean;
    currentPage: number;
    totalPages: number;
}

class DataGrid extends Component<DataGridProps, DataGridState> {
    private filterMap: Map<string, any> = new Map();
    private intervalId: NodeJS.Timeout | null = null;
    static contextType = React.createContext<ComponentFramework.Context<IInputs> | undefined>(undefined);
    declare context: React.ContextType<typeof DataGrid.contextType>;
    constructor(props: DataGridProps) {
        super(props);
        this.state = {
            records: [],
            totalPages: 1,
            selectedRecords: [],
            selectedRecordIds: [],
            filters: props.context.parameters.DataSource.columns.reduce((acc: any, col: any) => {
                acc[col.name] = {
                    operator: FilterOperator.AND,
                    constraints: [{ value: null, matchMode: FilterMatchMode.CONTAINS }]
                };
                return acc;
            }, {}),
            globalFilterValue: '',
            columns: [],
            previousParameters: {},
            enabled: props.context.parameters.IsEnabled?.raw ?? true,
            needsRefresh: false,
            currentPage: 1,
        };
    }

    componentDidMount() {
        (window as any).context = this.props.context;
        console.log(this.props.context)

        if (this.props.context.parameters.DataSource && !this.props.context.parameters.DataSource.loading) {
            this.mapRecordsToState();
        } else {
            console.log("Data source not ready at mount.");
        }
        this.saveCurrentParametersToState();
        const cardElement = document.querySelector('.card');
        if (cardElement && cardElement.parentElement && cardElement.parentElement.parentElement) {
            cardElement.parentElement.parentElement.style.overflowY = 'auto';
            cardElement.parentElement.parentElement.style.overflowX = 'auto';
        }

        this.checkAndStartInterval();
        this.forceRefreshDataset();

    }

    componentWillUnmount() {
        this.clearRefreshInterval();
    }

    checkAndStartInterval() {
        (window as any).context = this.props.context;
        const paging = this.context?.parameters.DataSource.paging;
        if (this.state.needsRefresh) {
            if (!this.intervalId) {
                //console.log('Starting refresh interval...');
                this.intervalId = setInterval(() => {
                    //console.log("Pinging for new records...");
                    this.mapRecordsToState();
                }, 5000);
            }
        } else {
            this.clearRefreshInterval();
        }
    }

    clearRefreshInterval() {
        if (this.intervalId) {
            //console.log('Clearing refresh interval...');
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    saveCurrentParametersToState() {
        const { context } = this.props;
        const parameterValues: { [key in keyof IInputs]?: any } = {};

        Object.keys(context.parameters).forEach((key) => {
            const param = context.parameters[key as keyof IInputs];
            if (this.hasRawProperty(param)) {
                parameterValues[key as keyof IInputs] = param.raw;
            }
        });

        this.setState({ previousParameters: parameterValues });
    }

    formatCurrency(value: any, currency: string): string {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
        }).format(value);
    }

    formatDecimal(value: any, decimalPlaces: number): string {
        return new Intl.NumberFormat("en-US", {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces,
        }).format(value);
    }

    parseConfigurations(configString: string): Record<string, any> {
        const configs: Record<string, any> = {};
      
        try {
          // Split by comma for each field
          const fields = configString.split(",");
          fields.forEach((field) => {
            const [fieldName, config] = field.split("=");
            if (fieldName && config) {
              // Split configurations by "|" and ":" for key-value pairs
              const configObject = config.split("|").reduce((acc, pair) => {
                const [key, value] = pair.split(":");
                if (key && value) acc[key.trim()] = value.trim();
                return acc;
              }, {} as Record<string, any>);
              configs[fieldName.trim()] = configObject;
            }
          });
        } catch (error) {
          console.error("Error parsing FieldConfigurations:", error);
        }
      
        return configs;
      }
      
     


      mapRecordsToState(force = false) {
        const { context } = this.props;
        const dataSet = context.parameters.DataSource as ComponentFramework.PropertyTypes.DataSet;
      console.log("map to state")
        // Parse field configurations
        let fieldConfig: Record<string, any> = {};
        try {
          const rawConfig = context.parameters.FieldConfigurations?.raw || "{}";
          fieldConfig = this.parseConfigurations(rawConfig);
        } catch (error) {
          console.error("Invalid JSON in FieldConfigurations:", context.parameters.FieldConfigurations?.raw, error);
        }

        const typeHandlers: Record<string, (value: any, config: any, context: ComponentFramework.Context<IInputs>) => any> = {
            "Currency": (value, config) => this.formatCurrency(value, config?.currency || "USD"),
            "DateAndTime.DateAndTime": (value, config, context) =>
              formatDate(new Date(value), config?.dateFormat || "yyyy-MM-dd HH:mm:ss", context),
            "DateAndTime.DateOnly": (value, config, context) =>
              formatDate(new Date(value), config?.dateFormat || "yyyy-MM-dd", context),
            "Decimal": (value, config) => this.formatDecimal(value, parseInt(config?.decimalPlaces) || 2),
            "TwoOptions": (value, config) => (value ? config?.trueLabel || "Yes" : config?.falseLabel || "No"),
            "SingleLine.Email": (value) => `mailto:${value}`,
            "SingleLine.Phone": (value) => `tel:${value}`,
            "SingleLine.URL": (value) => `<a href="${value}">${value}</a>`,
            "Object": (value) => JSON.stringify(value),
            // Add more as needed
          };

        //const dateFormat = context.parameters.DateFormat?.raw || availablePatterns[0] || "yyyy-MM-dd";
        //const fieldConfigs = JSON.parse(context.parameters.FieldConfigurations?.raw || "{}");
        //console.log('Starting mapRecordsToState...');
        if (!dataSet) {
            //console.log('DataSet is undefined.');
            return;
        }

        if (dataSet.paging.totalResultCount === -1) {
            console.log("unable to retrieve records, because paging.totalResultCount is -1")
        }

        if (dataSet.loading && !force) {
            //console.log('DataSet is still loading.');
            return;
        }

        if (!dataSet.sortedRecordIds.length) {
            //console.log('No sorted record IDs found.');
            // Trigger data fetch or reload
            if (dataSet.paging && dataSet.paging.loadNextPage) {
                //console.log('Attempting to load next page...');
                dataSet.paging.loadNextPage();
            }
            return;
        }

        const records = dataSet.sortedRecordIds.map((recordId) => {
            const record = dataSet.records[recordId];
            if (!record) {
                //console.log(`Record ID ${recordId} not found in dataSet.records.`);
                return null;
            }
            console.log("preproceed record", record)
            const processedRecord = {
                id: recordId,
                ...dataSet.columns.reduce((rec: Record<string, any>, col) => {
                    const value = record.getValue(col.alias);
                    const colType = col.dataType;
                    //Decimal SingleLine.Text
                    try {
                        // Use the typeHandlers map to process the column type
                        rec[col.name] = typeHandlers[colType]
                          ? typeHandlers[colType](value, fieldConfig, context)
                          : value; // Default case for unsupported data types
                          console.log("Type handler",typeHandlers[colType])
                      } catch (error) {
                        console.error(`Error processing column "${col.name}" of type "${colType}":`, error);
                        rec[col.name] = value; // Fallback to raw value
                      }
                      return rec;
                }, {}),
            };

            console.log('Processed record:', processedRecord);
            return processedRecord;
        }).filter(Boolean);

        //console.log('Final mapped records:', records);
        //console.log('Columns:', dataSet.columns);

        this.setState(prevState => {
            const isRecordsChanged = !isEqual(prevState.records, records);
            const isColumnsChanged = !isEqual(prevState.columns, dataSet.columns);

            if (isRecordsChanged || isColumnsChanged) {
                //console.log('Updating state with new records and columns.');
                return {
                    records,
                    columns: dataSet.columns,
                    needsRefresh: false
                };
            }

            //console.log('No changes detected in records or columns. Skipping state update.');
            return null;
        });
    }


    updateFilters(columns: ComponentFramework.PropertyHelper.DataSetApi.Column[], previousFilters: any) {
        return columns.reduce((acc: any, col: any) => {
            acc[col.name] = previousFilters[col.name] || {
                operator: FilterOperator.AND,
                constraints: [{ value: null, matchMode: FilterMatchMode.CONTAINS }]
            };
            return acc;
        }, {});
    }

    componentDidUpdate(prevProps: Readonly<DataGridProps>, prevState: Readonly<DataGridState>): void {
        const { context } = this.props;
        const dataSet = context.parameters.DataSource as ComponentFramework.PropertyTypes.DataSet;

        if (!dataSet || dataSet.loading) {
            //console.log('DataSet is invalid or still loading. Skipping update.');
            return;
        }

        const dataSourceChanged = prevProps.context.parameters.DataSource !== this.props.context.parameters.DataSource;
        const sortedRecordIdsChanged =
            JSON.stringify(prevProps.context.parameters.DataSource.sortedRecordIds) !== JSON.stringify(dataSet.sortedRecordIds);

        const filtersChanged = JSON.stringify(prevState.filters) !== JSON.stringify(this.state.filters);
        const prevFieldConfigurations = prevProps.context.parameters.FieldConfigurations?.raw || "";
    const currentFieldConfigurations = this.props.context.parameters.FieldConfigurations?.raw || "";
    
        const fieldConfigurationsChanged = prevFieldConfigurations !== currentFieldConfigurations;


        if (dataSourceChanged || sortedRecordIdsChanged || filtersChanged || fieldConfigurationsChanged) {
            console.log("Changes detected in DataSource, records, filters, or FieldConfigurations. Updating state.");
            this.mapRecordsToState();
            this.forceRefreshDataset();
            //this.setState({ previousFieldConfigurations: currentFieldConfigurations });
        }

        if (!this.areColumnsEqual(prevState.columns, dataSet.columns)) {
            //console.log('Columns have changed. Updating filters.');
            const newFilters = this.updateFilters(dataSet.columns, prevState.filters);

            if (JSON.stringify(prevState.filters) !== JSON.stringify(newFilters)) {
                //console.log('Filters have changed. Updating state.');
                this.setState({ filters: newFilters, needsRefresh: true });
                this.forceRefreshDataset();
            }
        }

        if (prevState.needsRefresh !== this.state.needsRefresh) {
            this.checkAndStartInterval();
            this.forceRefreshDataset();
        }

        if (!this.state.records.length && !dataSet.loading) {
            //console.log('No records found in state. Triggering mapRecordsToState again.');
            this.mapRecordsToState();
        }
    }


    hasRawProperty(param: any): param is { raw: any } {
        return param && typeof param === 'object' && 'raw' in param;
    }

    areColumnsEqual(
        currentColumns: ComponentFramework.PropertyHelper.DataSetApi.Column[],
        nextColumns: ComponentFramework.PropertyHelper.DataSetApi.Column[]
    ): boolean {
        if (currentColumns.length !== nextColumns.length) {
            return false;
        }

        for (let i = 0; i < currentColumns.length; i++) {
            if (
                currentColumns[i].name !== nextColumns[i].name ||
                currentColumns[i].displayName !== nextColumns[i].displayName
            ) {
                return false;
            }
        }

        return true;
    }
    // Triggers when new data set is loaded in
    shouldComponentUpdate(nextProps: Readonly<DataGridProps>, nextState: Readonly<DataGridState>): boolean {
        console.log("component udpated")
        console.log(this.props.context.parameters.DataSource.columns)
        console.log(this.props.context.parameters.DataSource)
        const parameterKeys: (keyof IInputs)[] = Object.keys(nextProps.context.parameters) as (keyof IInputs)[];
        const needsRefresh = nextState.needsRefresh;
        if (needsRefresh) {
            this.props.context.parameters.DataSource.refresh();
        }
        for (const key of parameterKeys) {
            const nextParam = nextProps.context.parameters[key];
            const previousParam = this.state.previousParameters[key];

            if (this.hasRawProperty(nextParam)) {
                const nextRaw = nextParam.raw;
                const hasRawCurrent = this.hasRawProperty(previousParam);

                // //console.log(`Checking parameter '${key}':`, {
                //     previousParam: hasRawCurrent ? previousParam?.raw : previousParam,
                //     nextParam: nextRaw,
                //     hasRaw: true,
                // });

                if (previousParam !== nextRaw) {
                    //console.log(`Parameter '${key}' has changed. Previous:`, previousParam, "Next:", nextRaw);
                    return true;
                }
            } else {
                //console.log(`Parameter '${key}' does not have a 'raw' property. Skipping check.`);
            }
        }

        const currentColumns = this.state.columns;
        const nextColumns = nextProps.context.parameters.DataSource.columns;

        if (!this.areColumnsEqual(currentColumns, nextColumns)) {
            //console.log("Columns have changed. Component should update.");
            return true;
        }

        if (JSON.stringify(this.state.filters) !== JSON.stringify(nextState.filters)) {
            //console.log("Filters have changed. Component should update.");
            return true;
        }

        //console.log("No changes detected, component should not update.");
        return false;
    }

    onGlobalFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        this.setState({
            globalFilterValue: value,
            filters: {
                ...this.state.filters,
                global: { value, matchMode: FilterMatchMode.CONTAINS }
            }
        }, () => {
            this.forceUpdate();
        });
    };

    onSelectionChange = (e: any) => {
        const gridIsEnabled = this.props.context.parameters.IsEnabled?.raw ?? false;
        if (!gridIsEnabled) {
            return;
        }
    
        // Handle single or multiple selection
        const newSelectedRecords = Array.isArray(e.value) ? e.value : e.value ? [e.value] : [];
        const newSelectedRecordIds = newSelectedRecords.map((record: any) => record.id);
    
        this.props.context.parameters.DataSource.setSelectedRecordIds(newSelectedRecordIds);
        this.setState({
            selectedRecordIds: newSelectedRecordIds,
            selectedRecords: newSelectedRecords,
        }, () => {
            this.forceUpdate();
        });
    };

    renderHeader() {
        const displayHeader = this.props.context.parameters.DisplayHeader?.raw ?? false;
        const displaySearch = this.props.context.parameters.DisplaySearch?.raw ?? false;
        const headerText = this.props.context.parameters.HeaderText?.raw ?? this.props.context.parameters.DataSource.getTargetEntityType();

        if (!displayHeader) {
            return null;
        }

        return (
            <div className="flex flex-wrap gap-2 justify-content-between align-items-center">
                <h4 className="m-0">{headerText}</h4>
                {displaySearch && (
                    <IconField iconPosition="left">
                        <InputIcon className="pi pi-search" />
                        <InputText
                            value={this.state.globalFilterValue}
                            onChange={this.onGlobalFilterChange}
                            placeholder="Keyword Search"
                        />
                    </IconField>
                )}
            </div>
        );
    }
    getFieldValue(col: ComponentFramework.PropertyHelper.DataSetApi.Column): string {
        return col.alias || col.name;
    }

    getRecordsFromContext(): any[] {
        const { context } = this.props;
        if (context.parameters.DataSource && !context.parameters.DataSource.loading) {
            const dataSet = context.parameters.DataSource as ComponentFramework.PropertyTypes.DataSet;
            ////console.log('DataSet:', dataSet);

            const records = dataSet.sortedRecordIds.map(recordId => {
                const record = dataSet.records[recordId];
                return {
                    id: recordId,
                    ...dataSet.columns.reduce((rec: Record<string, any>, col) => {
                        rec[col.name] = record.getValue(col.alias);
                        //console.log(rec)
                        return rec;
                    }, {})
                };
            });
            ////console.log('Mapped Records:', records);
            return records;
        }
        return [];
    }

   forceRefreshDataset = async () => {
        const { context } = this.props;
        const dataSet = context.parameters.DataSource;

        // Trigger dataset refresh
        dataSet.refresh();
        this.props.notifyOutputChanged();

        // Wait for the dataset to finish loading
        const waitForData = async (timeoutMs = 5000): Promise<void> => {
            const start = Date.now();
            while (dataSet.loading && Date.now() - start < timeoutMs) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms
            }
            if (dataSet.loading) {
                console.warn("Dataset loading timed out");
            }
        };

        await waitForData();
        this.mapRecordsToState(true); // Force mapping even if loading
    };

    render() {
        const { context } = this.props;
        const paging = context.parameters.DataSource.paging;
        const { records, selectedRecordIds, filters } = this.state;
        const header = this.renderHeader();
        const displayPagination = context.parameters.DisplayPagination?.raw ?? true;
        const emptyMessage = context.parameters.EmptyMessage?.raw ?? "No records found.";
        const filterDisplayType = "menu";
        const allowedSelectionModes: Array<"multiple" | "checkbox"> = ["multiple", "checkbox"];
        const selectionMode = (context.parameters.SelectionMode?.raw && allowedSelectionModes.includes(context.parameters.SelectionMode?.raw as any))
            ? (context.parameters.SelectionMode?.raw as "multiple" | "checkbox")
            : "multiple";
        const allowSorting = context.parameters.AllowSorting?.raw ?? false;
        const allowMulti = context.parameters.AllowMultipleSelection?.raw ?? false;
        const allowFiltering = context.parameters.AllowFiltering?.raw ?? false;
        const rowsPerPageOptions = [5, 15, 25];
    
        const onRenderItemColumn = (
            item?: Record<string, any>,
            index?: number,
            column?: IColumn,
        ) => {
            if (column && column.fieldName && item) {
                const value = item[column.fieldName];
                if (value && typeof value === "object" && value.toString) {
                    return value.toString();
                }
                return value ?? "";
            }
            return null;
        };
    
        type IColumn = {
            fieldName: string;
        };
    
        return (
            <div className="card" style={{ display: "flex", width: "100%", height: "100%", overflow: "auto" }}>
                <DataTable
                    lazy
                    value={records}
                    paginator={displayPagination}
                    header={header}
                    rows={paging.pageSize}
                    paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport RowsPerPageDropdown"
                    rowsPerPageOptions={rowsPerPageOptions}
                    first={(this.state.currentPage - 1) * paging.pageSize}
                    totalRecords={paging.totalResultCount >= 0 ? paging.totalResultCount : 0}
                    onPage={(e: DataTableStateEvent) => {
                        const { page, rows } = e;
                        const paging = this.props.context.parameters.DataSource.paging;
                        if (!paging) {
                            console.log("Paging is undefined");
                            return;
                        }
    
                        if (page === undefined) {
                            console.warn("Page is undefined in onPage event. Defaulting to page 1.");
                            return;
                        }
    
                        const totalPages = Math.ceil(paging.totalResultCount / rows);
                        const targetPage = page + 1;
    
                        if (rows !== paging.pageSize) {
                            console.log("Changing rows per page to:", rows);
                            paging.setPageSize(rows);
                            paging.reset();
                            this.setState({ currentPage: 1 }, () => {
                                this.forceRefreshDataset();
                            });
                        } else if (targetPage !== this.state.currentPage && targetPage >= 1 && targetPage <= totalPages) {
                            console.log("Navigating to page:", targetPage);
                            paging.loadExactPage(targetPage);
                            this.setState({ currentPage: targetPage }, () => {
                                this.forceRefreshDataset();
                            });
                        } else {
                            console.log("No action taken for paging");
                        }
                    }}
                    dataKey="id"
                    selectionMode={selectionMode}
                    selection={records.filter(record => selectedRecordIds.includes(record.id))}
                    onSelectionChange={this.onSelectionChange}
                    filters={filters}
                    filterDisplay={filterDisplayType as "menu" | "row"}
                    globalFilterFields={context.parameters.DataSource.columns.map(col => col.name)}
                    emptyMessage={emptyMessage}
                    currentPageReportTemplate={`Showing {first} to {last} of ${paging.totalResultCount >= 0 ? paging.totalResultCount : 0} entries`}
                    scrollable
                    scrollHeight="flex"
                    style={{ width: "100%", minWidth: "0" }}
                >
                    <Column selectionMode={allowMulti ? "multiple" : "single"} headerStyle={{ width: "3rem" }}></Column>
                    {context.parameters.DataSource.columns.map((col, index) => (
                        <Column
                            key={index}
                            field={col.name}
                            header={col.displayName}
                            sortable={allowSorting}
                            filter={allowFiltering}
                            filterPlaceholder={`Search by ${col.displayName}`}
                            showFilterMatchModes
                            style={{ minWidth: "12rem" }}
                            body={(item) => onRenderItemColumn(item, undefined, { fieldName: col.name } as IColumn)}
                        />
                    ))}
                </DataTable>
            </div>
        );
    }
}

export default DataGrid;