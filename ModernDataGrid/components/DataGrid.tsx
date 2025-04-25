import React, { Component } from 'react';
import { FilterMatchMode } from 'primereact/api';
import { DataTable } from 'primereact/datatable';
import isEqual from 'lodash.isequal';
import { Column } from 'primereact/column';
import { InputText } from 'primereact/inputtext';
import { IconField } from 'primereact/iconfield';
import { InputIcon } from 'primereact/inputicon';
import { IInputs } from '../generated/ManifestTypes';
import { formatDate } from '../helpers/Utils';
import 'primereact/resources/themes/saga-blue/theme.css';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';
import 'primeflex/primeflex.css';
import './DataGrid.css';

interface DataGridProps {
    context: ComponentFramework.Context<IInputs>;
    notifyOutputChanged: () => void;
}

interface DataGridState {
    records: any[];
    selectedRecordIds: any[];
    selectedRecords: any[];
    globalFilterValue: string;
    columns: ComponentFramework.PropertyHelper.DataSetApi.Column[];
    previousParameters: { [key in keyof IInputs]?: any };
    enabled: boolean;
    needsRefresh: boolean;
    currentPage: number;
    totalPages: number;
    records2: any[];
}

class DataGrid extends Component<DataGridProps, DataGridState> {
    private rawRecords: any[] = [];
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
            globalFilterValue: '',
            columns: [],
            previousParameters: {},
            enabled: props.context.parameters.IsEnabled?.raw ?? true,
            needsRefresh: false,
            currentPage: 1,
            records2: this.generateDummyData(),
        };
    }

    generateDummyData() {
        const dummy: any[] = [];
        for (let i = 1; i <= 20; i++) {
            dummy.push({
                id: i,
                name: `User ${i}`,
                email: `user${i}@example.com`,
                country: `Country ${i % 5 + 1}`,
                status: i % 2 === 0 ? 'Active' : 'Inactive',
            });
        }
        return dummy;
    }

    componentDidMount() {
        (window as any).context = this.props.context;
        if (this.props.context.parameters.DataSource && !this.props.context.parameters.DataSource.loading) {
            this.mapRecordsToState();
        } else {
            console.log('Data source not ready at mount.');
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
                this.intervalId = setInterval(() => {
                    this.mapRecordsToState();
                }, 5000);
            }
        } else {
            this.clearRefreshInterval();
        }
    }

    clearRefreshInterval() {
        if (this.intervalId) {
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
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
        }).format(value);
    }

    formatDecimal(value: any, decimalPlaces: number): string {
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces,
        }).format(value);
    }

    parseConfigurations(configString: string): Record<string, any> {
        const configs: Record<string, any> = {};
        try {
            const fields = configString.split(',');
            fields.forEach((field) => {
                const [fieldName, config] = field.split('=');
                if (fieldName && config) {
                    const configObject = config.split('|').reduce((acc, pair) => {
                        const [key, value] = pair.split(':');
                        if (key && value) acc[key.trim()] = value.trim();
                        return acc;
                    }, {} as Record<string, any>);
                    configs[fieldName.trim()] = configObject;
                }
            });
        } catch (error) {
            console.error('Error parsing FieldConfigurations:', error);
        }
        return configs;
    }

    mapRecordsToState(force = false) {
        const { context } = this.props;
        const dataSet = context.parameters.DataSource as ComponentFramework.PropertyTypes.DataSet;

        let fieldConfig: Record<string, any> = {};
        try {
            const rawConfig = context.parameters.FieldConfigurations?.raw || '{}';
            fieldConfig = this.parseConfigurations(rawConfig);
        } catch (error) {
            console.error('Invalid JSON in FieldConfigurations:', context.parameters.FieldConfigurations?.raw, error);
        }

        const typeHandlers: Record<string, (value: any, config: any, context: ComponentFramework.Context<IInputs>) => any> = {
            Currency: (value, config) => this.formatCurrency(value, config?.currency || 'USD'),
            'DateAndTime.DateAndTime': (value, config, context) =>
                formatDate(new Date(value), config?.dateFormat || 'yyyy-MM-dd HH:mm:ss', context),
            'DateAndTime.DateOnly': (value, config, context) =>
                formatDate(new Date(value), config?.dateFormat || 'yyyy-MM-dd', context),
            Decimal: (value, config) => this.formatDecimal(value, parseInt(config?.decimalPlaces) || 2),
            TwoOptions: (value, config) => (value ? config?.trueLabel || 'Yes' : config?.falseLabel || 'No'),
            'SingleLine.Email': (value) => `mailto:${value}`,
            'SingleLine.Phone': (value) => `tel:${value}`,
            'SingleLine.URL': (value) => `<a href="${value}">${value}</a>`,
            File: (value) => (value && value.fileName ? value.fileName : 'No File'),
            Object: (value) => (value ? JSON.stringify(value) : ''),
        };

        if (!dataSet) {
            console.log('DataSet is undefined.');
            return;
        }

        if (dataSet.paging.totalResultCount === -1) {
            console.log('Unable to retrieve records, because paging.totalResultCount is -1');
        }

        if (dataSet.loading && !force) {
            console.log('DataSet is still loading.');
            return;
        }

        if (!dataSet.sortedRecordIds.length) {
            console.log('No sorted record IDs found.');
            if (dataSet.paging && dataSet.paging.loadNextPage) {
                console.log('Attempting to load next page...');
                dataSet.paging.loadNextPage();
            }
            return;
        }

        const records = dataSet.sortedRecordIds.map((recordId) => {
            const record = dataSet.records[recordId];
            if (!record) {
                console.log(`Record ID ${recordId} not found in dataSet.records.`);
                return null;
            }

            const processedRecord = {
                id: recordId,
                ...dataSet.columns.reduce((rec: Record<string, any>, col) => {
                    const value = record.getValue(col.alias);
                    const colType = col.dataType;

                    try {
                        rec[col.name] = typeHandlers[colType]
                            ? typeHandlers[colType](value, fieldConfig, context)
                            : typeof value === 'object' && value !== null
                                ? JSON.stringify(value)
                                : value ?? '';
                    } catch (error) {
                        console.error(`Error processing column "${col.name}" of type "${colType}":`, error);
                        rec[col.name] = value ?? '';
                    }
                    return rec;
                }, {}),
            };

            return processedRecord;
        }).filter(Boolean);

        this.rawRecords = records;

        this.setState(
            (prevState) => {
                const isRecordsChanged = !isEqual(prevState.records, records);
                const isColumnsChanged = !isEqual(prevState.columns, dataSet.columns);

                if (isRecordsChanged || isColumnsChanged) {
                    console.log('Updating state with new records and columns.');
                    return {
                        records,
                        columns: dataSet.columns,
                        needsRefresh: false,
                    };
                }

                console.log('No changes detected in records or columns. Skipping state update.');
                return null;
            },
            () => {
                this.props.notifyOutputChanged();
            }
        );
    }

    componentDidUpdate(prevProps: Readonly<DataGridProps>, prevState: Readonly<DataGridState>): void {
        const { context } = this.props;
        const dataSet = context.parameters.DataSource as ComponentFramework.PropertyTypes.DataSet;

        if (!dataSet || dataSet.loading) {
            console.log('DataSet is invalid or still loading. Skipping update.');
            return;
        }

        const dataSourceChanged = prevProps.context.parameters.DataSource !== this.props.context.parameters.DataSource;
        const sortedRecordIdsChanged =
            JSON.stringify(prevProps.context.parameters.DataSource.sortedRecordIds) !== JSON.stringify(dataSet.sortedRecordIds);
        const prevFieldConfigurations = prevProps.context.parameters.FieldConfigurations?.raw || '';
        const currentFieldConfigurations = this.props.context.parameters.FieldConfigurations?.raw || '';
        const fieldConfigurationsChanged = prevFieldConfigurations !== currentFieldConfigurations;

        if (dataSourceChanged || sortedRecordIdsChanged || fieldConfigurationsChanged) {
            console.log('Changes detected in DataSource, records, or FieldConfigurations. Updating state.');
            this.mapRecordsToState();
            this.forceRefreshDataset();
        }

        if (prevState.needsRefresh !== this.state.needsRefresh) {
            this.checkAndStartInterval();
            this.forceRefreshDataset();
        }

        if (!this.state.records.length && !dataSet.loading) {
            console.log('No records found in state. Triggering mapRecordsToState again.');
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

    shouldComponentUpdate(nextProps: Readonly<DataGridProps>, nextState: Readonly<DataGridState>): boolean {
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
                if (previousParam !== nextRaw) {
                    return true;
                }
            }
        }

        const currentColumns = this.state.columns;
        const nextColumns = nextProps.context.parameters.DataSource.columns;

        if (!this.areColumnsEqual(currentColumns, nextColumns)) {
            return true;
        }

        return false;
    }

    onGlobalFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        this.setState({ globalFilterValue: value });
    };

    onSelectionChange = (e: any) => {
        const gridIsEnabled = this.props.context.parameters.IsEnabled?.raw ?? false;
        if (!gridIsEnabled) {
            return;
        }

        const newSelectedRecords = Array.isArray(e.value) ? e.value : e.value ? [e.value] : [];
        const newSelectedRecordIds = newSelectedRecords.map((record: any) => record.id);

        this.props.context.parameters.DataSource.setSelectedRecordIds(newSelectedRecordIds);
        this.setState({
            selectedRecordIds: newSelectedRecordIds,
            selectedRecords: newSelectedRecords,
        });
    };

    renderHeader() {
        const displayHeader = this.props.context.parameters.DisplayHeader?.raw ?? false;
        // const displaySearch = this.props.context.parameters.DisplaySearch?.raw ?? false;
        const headerText = this.props.context.parameters.HeaderText?.raw ?? this.props.context.parameters.DataSource.getTargetEntityType();

        if (!displayHeader) {
            return null;
        }

        return (
            <div className="flex flex-wrap gap-2 justify-content-between align-items-center">
                <h4 className="m-0">{headerText}</h4>
            </div>
        );
        
    }

    forceRefreshDataset = async () => {
        const { context } = this.props;
        const dataSet = context.parameters.DataSource;

        dataSet.refresh();
        this.props.notifyOutputChanged();

        const waitForData = async (timeoutMs = 5000): Promise<void> => {
            const start = Date.now();
            while (dataSet.loading && Date.now() - start < timeoutMs) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            if (dataSet.loading) {
                console.warn('Dataset loading timed out');
            }
        };

        await waitForData();
        this.mapRecordsToState(true);
    };

    render() {
        const { context } = this.props;
        const { records, selectedRecordIds } = this.state;
        const header = this.renderHeader();
        const displayPagination = context.parameters.DisplayPagination?.raw ?? true;
        const emptyMessage = context.parameters.EmptyMessage?.raw ?? 'No records found.';
        const allowSorting = context.parameters.AllowSorting?.raw ?? false;
        const allowMulti = context.parameters.AllowMultipleSelection?.raw ?? false;
        const allowFiltering = context.parameters.AllowFiltering?.raw ?? false;
        const rowsPerPageOptions = [5, 15, 25];

        return (
            <div className="card" style={{ display: 'flex', width: '100%', height: '100%', overflow: 'auto' }}>
                <DataTable
                    value={records}
                    paginator={displayPagination}
                    rows={10}
                    paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport RowsPerPageDropdown"
                    rowsPerPageOptions={rowsPerPageOptions}
                    dataKey="id"
                    filterDisplay={allowFiltering ? 'row' : undefined}
                    globalFilterFields={context.parameters.DataSource.columns.map((col) => col.name)}
                    globalFilter={this.state.globalFilterValue || undefined}
                    header={header}
                    emptyMessage={emptyMessage}
                    style={{ width: '100%', minWidth: '0' }}
                    sortMode={allowSorting ? 'multiple' : undefined}
                    selectionMode={allowMulti ? 'checkbox' : null} // Use 'checkbox' for multiple, null for single
                    selection={allowMulti ? selectedRecordIds : selectedRecordIds[0] || null} // Handle single/multiple selection
                    onSelectionChange={this.onSelectionChange}
                >
                    <Column selectionMode={allowMulti ? "multiple" : "single"} headerStyle={{ width: "3rem" }}></Column>

                    {context.parameters.DataSource.columns.map((col, index) => (
                        <Column
                            key={index}
                            field={col.name}
                            header={col.displayName}
                            filter={allowFiltering}
                            filterPlaceholder={`Search by ${col.displayName}`}
                            style={{ minWidth: '12rem' }}
                            body={(rowData) => {
                                const value = rowData[col.name];
                                return value && typeof value === 'object' ? JSON.stringify(value) : value ?? '';
                            }}
                            sortable={allowSorting}
                        />
                    ))}
                </DataTable>
            </div>
        );
    }
}

export default DataGrid;